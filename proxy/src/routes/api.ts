import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { isOcrConfigured } from '../config.js';
import { requireAccessCode } from '../auth.js';
import { RateLimiter } from '../rateLimit.js';
import {
  callChatCompletions,
  type ChatMessage,
  UpstreamError,
} from '../modelAdapter.js';
import { createOcrRouter } from './ocr.js';

/**
 * POST /api/v1/generate-card (PRD §6.4)
 * Validate input → call model with structured JSON output → validate →
 * one repair retry → return card content. Client input never controls
 * the upstream URL or model (PRD §6.3).
 */

const GenerateCardRequest = z.object({
  term: z.string().trim().min(1).max(100),
  contextSentences: z.array(z.string().trim().min(1).max(1000)).max(5).default([]),
});

const SenseSchema = z.object({
  chinese: z.string().min(1),
  english: z.string().min(1),
  example: z.string().optional(),
});

const CardSchema = z.object({
  term: z.string().min(1),
  primaryChinese: z.string().min(1),
  primaryEnglish: z.string().min(1),
  exampleSentence: z.string().min(1),
  additionalSenses: z.array(SenseSchema).default([]),
});

const SYSTEM_PROMPT = `You are a bilingual dictionary assistant for a personal English vocabulary app.
Given an English word or phrase (and optional original sentences), produce dictionary content.

Rules:
- If original sentences are provided, pick the sense that matches usage in those sentences as the primary sense.
- Otherwise use the most common, modern, learning-appropriate sense as the primary sense.
- primaryChinese: concise Chinese definition.
- primaryEnglish: clear, natural English definition.
- exampleSentence: one idiomatic English sentence demonstrating the primary sense.
- additionalSenses: other common senses (chinese + english, optional short example). Empty array if none.
- Never include phonetics, part of speech, or audio.
- Never attribute content to any published dictionary.

Respond with ONLY a JSON object, no markdown fences, exactly matching:
{"term": string, "primaryChinese": string, "primaryEnglish": string, "exampleSentence": string, "additionalSenses": [{"chinese": string, "english": string, "example": string}]}`;

function extractJson(text: string): unknown {
  let t = text.trim();
  // Strip markdown code fences if present.
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  // Grab the outermost JSON object if surrounded by prose.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no_json_object_found');
  }
  return JSON.parse(t.slice(start, end + 1));
}

function buildUserMessage(term: string, contextSentences: string[]): string {
  const parts = [`Word/phrase: ${term}`];
  if (contextSentences.length > 0) {
    parts.push(
      'Original sentences where the user met it (choose the matching sense):',
    );
    parts.push(...contextSentences.map((s) => `- ${s}`));
  }
  return parts.join('\n');
}

export function createGenerateCardRouter(cfg: AppConfig): Router {
  const router = Router();
  const limiter = new RateLimiter(20, 60_000); // 20 model req/min per IP

  // Rate limit BEFORE the access-code check so brute-force attempts on
  // the shared code also consume the bucket (review finding #2).
  const rateLimited =
    (handler: (req: import('express').Request, res: import('express').Response) => void) =>
    (req: import('express').Request, res: import('express').Response) => {
      if (!limiter.allow(req.ip ?? 'unknown')) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      handler(req, res);
    };

  router.post(
    '/generate-card',
    rateLimited((req, res) => {
      requireAccessCode(cfg.APP_SHARED_ACCESS_CODE)(req, res, () => {
        handleGenerateCard(cfg, req, res);
      });
    }),
  );

  return router;
}

function handleGenerateCard(
  cfg: AppConfig,
  req: import('express').Request,
  res: import('express').Response,
): void {
    const parsed = GenerateCardRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const { term, contextSentences } = parsed.data;

    const attempt = (repairNote?: string): Promise<void> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(term, contextSentences) },
      ];
      if (repairNote) {
        messages.push({
          role: 'user',
          content: `Your previous answer was invalid: ${repairNote}. Respond again with ONLY the corrected JSON object.`,
        });
      }
      return callChatCompletions(cfg, messages).then((raw) => {
        let candidate: unknown;
        try {
          candidate = extractJson(raw);
        } catch (err) {
          // Unparseable output is recoverable: try one repair round.
          throw Object.assign(new Error('invalid_model_output'), {
            retryable: true,
            issues: err instanceof Error ? err.message : 'parse_failed',
          });
        }
        const card = CardSchema.safeParse(candidate);
        if (!card.success) {
          throw Object.assign(new Error('invalid_model_output'), {
            retryable: true,
            issues: card.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          });
        }
        res.json({
          ...card.data,
          generationModel: cfg.MODEL_NAME,
        });
      });
    };

    attempt().catch((err: NodeJS.ErrnoException & { retryable?: boolean; issues?: string }) => {
      if (err instanceof UpstreamError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err.retryable) {
        // One limited repair retry (PRD §4.5).
        attempt(err.issues ?? err.message)
          .then(() => undefined)
          .catch((retryErr: NodeJS.ErrnoException & { retryable?: boolean }) => {
            if (retryErr instanceof UpstreamError) {
              res.status(retryErr.status).json({ error: retryErr.message });
              return;
            }
            res.status(502).json({ error: 'invalid_model_output' });
          });
        return;
      }
      res.status(502).json({ error: 'generation_failed' });
    });
}

export function createApiRouter(cfg: AppConfig): Router {
  const router = Router();

  // GET /api/v1/health — minimal status, no secrets (PRD §6.4).
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      generationConfigured: true,
      ocrConfigured: isOcrConfigured(cfg),
    });
  });

  router.use(createGenerateCardRouter(cfg));
  router.use(createOcrRouter(cfg));
  return router;
}
