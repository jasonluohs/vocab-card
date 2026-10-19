import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import express from 'express';
import type { AppConfig } from '../src/config.js';
import { createApiRouter } from '../src/routes/api.js';

/** Mock upstream that accepts vision messages and returns OCR JSON. */
function makeVisionUpstream(): {
  server: http.Server;
  address: string;
  close: () => Promise<void>;
  lastBody: { get: () => any };
} {
  const state = { body: null as any };
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.post('/chat/completions', (req, res) => {
    state.body = req.body;
    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              text: 'The study aims to elucidate the mechanism.',
            }),
          },
        },
      ],
    });
  });
  const server = app.listen(0);
  return {
    server,
    address: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((r) => server.close(() => r())),
    lastBody: { get: () => state.body },
  };
}

function makeConfig(upstream: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    MODEL_BASE_URL: upstream,
    MODEL_NAME: 'mock-vision',
    MODEL_SUPPORTS_VISION: true,
    MODEL_API_KEY: 'sk-test',
    APP_SHARED_ACCESS_CODE: 'secret-code',
    OCR_PROVIDER: 'vision',
    ALLOWED_ORIGIN: '*',
    PORT: 0,
    ...overrides,
  } as AppConfig;
}

function startProxy(cfg: AppConfig): Promise<{ server: http.Server; url: string }> {
  const app = express();
  app.use('/api/v1', createApiRouter(cfg));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// A tiny valid 1x1 PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('POST /api/v1/ocr', () => {
  it('returns transcribed text and forwards the image upstream as a data URL', async () => {
    const upstream = makeVisionUpstream();
    const cfg = makeConfig(upstream.address);
    const { server, url } = await startProxy(cfg);
    try {
      const form = new FormData();
      form.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'page.png');
      const res = await fetch(`${url}/api/v1/ocr`, {
        method: 'POST',
        headers: { 'x-access-code': 'secret-code' },
        body: form,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { text: string };
      expect(body.text).toContain('elucidate');

      const upstreamBody = upstream.lastBody.get();
      const userMsg = upstreamBody.messages[1];
      const content = userMsg.content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe('image_url');
      expect(content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('requires the access code', async () => {
    const upstream = makeVisionUpstream();
    const cfg = makeConfig(upstream.address);
    const { server, url } = await startProxy(cfg);
    try {
      const form = new FormData();
      form.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'page.png');
      const res = await fetch(`${url}/api/v1/ocr`, { method: 'POST', body: form });
      expect(res.status).toBe(401);
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('rejects non-image files', async () => {
    const upstream = makeVisionUpstream();
    const cfg = makeConfig(upstream.address);
    const { server, url } = await startProxy(cfg);
    try {
      const form = new FormData();
      form.append('image', new Blob(['plain text'], { type: 'text/plain' }), 'a.txt');
      const res = await fetch(`${url}/api/v1/ocr`, {
        method: 'POST',
        headers: { 'x-access-code': 'secret-code' },
        body: form,
      });
      expect(res.status).toBe(400);
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('501 when the model is not vision-capable', async () => {
    const upstream = makeVisionUpstream();
    const cfg = makeConfig(upstream.address, { MODEL_SUPPORTS_VISION: false });
    const { server, url } = await startProxy(cfg);
    try {
      const form = new FormData();
      form.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'page.png');
      const res = await fetch(`${url}/api/v1/ocr`, {
        method: 'POST',
        headers: { 'x-access-code': 'secret-code' },
        body: form,
      });
      expect(res.status).toBe(501);
    } finally {
      server.close();
      await upstream.close();
    }
  });
});
