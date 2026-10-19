import express from 'express';
import { loadConfig } from './config.js';
import { createApiRouter } from './routes/api.js';

/**
 * vocab-card API proxy (PRD §6).
 * - No database, no user accounts, no stored photos.
 * - Shared access code + per-IP rate limiting + CORS allowlist.
 * - Model configuration is server-side only.
 */

const cfg = loadConfig();
const app = express();

// Behind nginx on the Aliyun box: trust exactly one proxy hop so req.ip
// resolves to the rightmost X-Forwarded-For entry (the real client IP
// appended by nginx), ignoring client-injected XFF prefixes.
app.set('trust proxy', 1);

// CORS: restrict to the configured PWA origin. CORS is NOT auth (PRD §6.3).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (cfg.ALLOWED_ORIGIN === '*' || origin === cfg.ALLOWED_ORIGIN)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS',
    );
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Body size limit: card generation is tiny; keep the surface minimal.
app.use(express.json({ limit: '64kb' }));

app.use('/api/v1', createApiRouter(cfg));

// Minimal error handling; never leak keys or upstream details.
app.use(
  (
    _err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal' });
  },
);

const port = cfg.PORT;
app.listen(port, () => {
  console.log(`vocab-card proxy listening on :${port}`);
});
