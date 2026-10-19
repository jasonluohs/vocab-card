import { Router } from 'express';
import Busboy from 'busboy';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { requireAccessCode } from '../auth.js';
import { RateLimiter } from '../rateLimit.js';
import { callChatCompletions, UpstreamError } from '../modelAdapter.js';

/**
 * POST /api/v1/ocr (PRD §6.4)
 * multipart/form-data with one `image` file. The image is processed only
 * within the request lifecycle: never written to disk, never logged,
 * never stored (PRD §4.4, §9).
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const OcrResultSchema = z.object({
  text: z.string().max(20_000),
});

const OCR_SYSTEM_PROMPT = `You transcribe text from photos of printed or handwritten pages.
Transcribe ALL visible text exactly as written, preserving line breaks and paragraph boundaries.
Fix obvious OCR-style artifacts only when the intent is unambiguous (e.g. broken ligatures).
Respond with ONLY a JSON object: {"text": "<the transcribed text>"}`;

type ReadImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; error: string };

function readImage(req: import('express').Request): Promise<ReadImageResult> {
  return new Promise((resolve) => {
    let busboy: Busboy.Busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
      });
    } catch {
      resolve({ ok: false, status: 400, error: 'invalid_multipart' });
      return;
    }

    let settled = false;
    const finish = (r: ReadImageResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    busboy.on('file', (name, stream, info) => {
      if (name !== 'image' || !info.mimeType.startsWith('image/')) {
        stream.resume();
        finish({ ok: false, status: 400, error: 'invalid_request' });
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => {
        finish({ ok: false, status: 413, error: 'image_too_large' });
      });
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          finish({ ok: false, status: 400, error: 'invalid_request' });
          return;
        }
        finish({
          ok: true,
          dataUrl: `data:${info.mimeType};base64,${buffer.toString('base64')}`,
        });
      });
    });

    busboy.on('error', () => finish({ ok: false, status: 400, error: 'invalid_multipart' }));
    busboy.on('close', () => {
      // No file part at all.
      setTimeout(() => finish({ ok: false, status: 400, error: 'invalid_request' }), 10);
    });

    req.pipe(busboy);
  });
}

function extractJsonField(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no_json_object_found');
  }
  return JSON.parse(t.slice(start, end + 1));
}

export function createOcrRouter(cfg: AppConfig): Router {
  const router = Router();
  const limiter = new RateLimiter(5, 60_000); // 5 OCR req/min per IP

  router.post(
    '/ocr',
    // Rate limit BEFORE the access-code check so brute-force attempts also
    // consume the bucket (review finding #2).
    (req, res, next) => {
      if (!limiter.allow(req.ip ?? 'unknown')) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      next();
    },
    requireAccessCode(cfg.APP_SHARED_ACCESS_CODE),
    async (req, res) => {
    const image = await readImage(req);
    if (!image.ok) {
      res.status(image.status).json({ error: image.error });
      return;
    }

    if (cfg.OCR_PROVIDER !== 'vision') {
      // Remote OCR provider path (adapter boundary, PRD §4.4).
      res.status(501).json({ error: 'ocr_remote_not_configured' });
      return;
    }
    if (!cfg.MODEL_SUPPORTS_VISION) {
      res.status(501).json({ error: 'ocr_not_configured' });
      return;
    }

    try {
      const raw = await callChatCompletions(cfg, [
        { role: 'system', content: OCR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: image.dataUrl },
            },
          ],
        },
      ]);
      const parsed = OcrResultSchema.safeParse(extractJsonField(raw));
      if (!parsed.success) {
        res.status(502).json({ error: 'invalid_model_output' });
        return;
      }
      res.json(parsed.data);
    } catch (err) {
      if (err instanceof UpstreamError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: 'ocr_failed' });
    }
  });

  return router;
}
