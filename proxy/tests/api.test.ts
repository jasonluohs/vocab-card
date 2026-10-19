import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AppConfig } from '../src/config.js';
import { createApiRouter } from '../src/routes/api.js';
import { RateLimiter } from '../src/rateLimit.js';

/**
 * Mock OpenAI-compatible upstream. Each response is consumed once in order.
 */
class MockUpstream {
  server: http.Server;
  url = '';
  requests: Array<{ auth?: string; body: any }> = [];

  constructor(private responses: Array<{ status?: number; content: string }>) {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.post('/chat/completions', (req, res) => {
      this.requests.push({ auth: req.headers.authorization, body: req.body });
      const next = this.responses.shift() ?? { content: '{}' };
      res.status(next.status ?? 200).json({
        choices: [{ message: { content: next.content } }],
      });
    });
    this.server = app.listen(0);
  }

  get address(): string {
    const addr = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function makeConfig(upstream: MockUpstream, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    MODEL_BASE_URL: upstream.address,
    MODEL_NAME: 'mock-model',
    MODEL_SUPPORTS_VISION: false,
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
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/v1', createApiRouter(cfg));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const VALID_CARD = JSON.stringify({
  term: 'elucidate',
  primaryChinese: '阐明；解释清楚',
  primaryEnglish: 'To make something clear.',
  exampleSentence: 'The study aims to elucidate the mechanism.',
  additionalSenses: [{ chinese: '详述', english: 'To explain in more detail.' }],
});

describe('GET /api/v1/health', () => {
  it('returns ok with generation and ocr flags, no secrets', async () => {
    const upstream = new MockUpstream([]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, any>;
      expect(body.ok).toBe(true);
      expect(body.generationConfigured).toBe(true);
      expect(body.ocrConfigured).toBe(false); // MODEL_SUPPORTS_VISION=false
      expect(JSON.stringify(body)).not.toContain('sk-test');
      expect(JSON.stringify(body)).not.toContain('secret-code');
    } finally {
      server.close();
      await upstream.close();
    }
  });
});

describe('POST /api/v1/generate-card', () => {
  it('rejects missing or wrong access code with 401', async () => {
    const upstream = new MockUpstream([]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const noHeader = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ term: 'run' }),
      });
      expect(noHeader.status).toBe(401);

      const wrong = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'wrong' },
        body: JSON.stringify({ term: 'run' }),
      });
      expect(wrong.status).toBe(401);
      expect(upstream.requests).toHaveLength(0); // never reached the model
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('rejects invalid request bodies with 400', async () => {
    const upstream = new MockUpstream([]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
        body: JSON.stringify({ term: '' }),
      });
      expect(res.status).toBe(400);
      expect(upstream.requests).toHaveLength(0);
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('returns a valid card on success and forwards Bearer key upstream', async () => {
    const upstream = new MockUpstream([{ content: VALID_CARD }]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
        body: JSON.stringify({
          term: 'elucidate',
          contextSentences: ['The study aims to elucidate the mechanism.'],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, any>;
      expect(body.primaryChinese).toContain('阐明');
      expect(body.generationModel).toBe('mock-model');

      expect(upstream.requests).toHaveLength(1);
      expect(upstream.requests[0].auth).toBe('Bearer sk-test');
      // The user prompt contains the term and the context sentence.
      const messages = upstream.requests[0].body.messages;
      expect(messages[1].content).toContain('elucidate');
      expect(messages[1].content).toContain('mechanism');
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('strips markdown fences around JSON', async () => {
    const fenced = '```json\n' + VALID_CARD + '\n```';
    const upstream = new MockUpstream([{ content: fenced }]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
        body: JSON.stringify({ term: 'elucidate' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, any>;
      expect(body.exampleSentence).toContain('elucidate');
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('repairs one invalid output, then fails with 502 if still invalid', async () => {
    const upstream = new MockUpstream([
      { content: 'not json at all' },
      { content: 'still not json' },
    ]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
        body: JSON.stringify({ term: 'run' }),
      });
      expect(res.status).toBe(502);
      // Exactly one repair retry happened.
      expect(upstream.requests).toHaveLength(2);
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('recovers on the repair retry', async () => {
    const upstream = new MockUpstream([{ content: 'garbage' }, { content: VALID_CARD }]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
        body: JSON.stringify({ term: 'elucidate' }),
      });
      expect(res.status).toBe(200);
      expect(upstream.requests).toHaveLength(2);
      // Repair message includes the validation issues.
      const repair = upstream.requests[1].body.messages.at(-1).content;
      expect(repair).toContain('invalid');
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('rejects schema-invalid cards (empty required fields)', async () => {
    const badCard = JSON.stringify({
      term: 'run',
      primaryChinese: '',
      primaryEnglish: 'To move fast.',
      exampleSentence: 'She runs.',
      additionalSenses: [],
    });
    const upstream = new MockUpstream([{ content: badCard }, { content: badCard }]);
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      const res = await fetch(`${url}/api/v1/generate-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
        body: JSON.stringify({ term: 'run' }),
      });
      expect(res.status).toBe(502);
    } finally {
      server.close();
      await upstream.close();
    }
  });

  it('rate limits after 20 requests per minute per IP', async () => {
    const upstream = new MockUpstream(
      Array.from({ length: 25 }, () => ({ content: VALID_CARD })),
    );
    const cfg = makeConfig(upstream);
    const { server, url } = await startProxy(cfg);
    try {
      let last = 0;
      for (let i = 0; i < 22; i++) {
        const res = await fetch(`${url}/api/v1/generate-card`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-access-code': 'secret-code' },
          body: JSON.stringify({ term: 'run' }),
        });
        last = res.status;
      }
      expect(last).toBe(429);
    } finally {
      server.close();
      await upstream.close();
    }
  });
});

describe('RateLimiter', () => {
  it('allows up to N per window and recovers after the window', () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.allow('ip', 0)).toBe(true);
    expect(limiter.allow('ip', 100)).toBe(true);
    expect(limiter.allow('ip', 200)).toBe(true);
    expect(limiter.allow('ip', 300)).toBe(false);
    expect(limiter.allow('other-ip', 300)).toBe(true); // isolated keys
    expect(limiter.allow('ip', 1001)).toBe(true); // window slid
  });
});
