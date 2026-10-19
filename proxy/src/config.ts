import fs from 'node:fs';
import { z } from 'zod';

/**
 * Server-side configuration (PRD §6.2).
 * Secrets come from environment variables (or .env in local dev only).
 * The frontend NEVER receives any of these values.
 */

/** Minimal .env loader so local dev works without extra deps. */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv('.env');

const ConfigSchema = z.object({
  MODEL_BASE_URL: z.string().url(),
  MODEL_NAME: z.string().min(1),
  MODEL_SUPPORTS_VISION: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  MODEL_API_KEY: z.string().min(1),
  APP_SHARED_ACCESS_CODE: z.string().min(1),
  OCR_PROVIDER: z.enum(['vision', 'remote']).default('vision'),
  OCR_API_URL: z.string().url().optional(),
  OCR_API_KEY: z.string().optional(),
  ALLOWED_ORIGIN: z.string().default('*'),
  PORT: z.coerce.number().default(8787),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => i.path.join('.'))
      .join(', ');
    throw new Error(`Invalid proxy configuration: ${missing}`);
  }
  return parsed.data;
}

export function isOcrConfigured(cfg: AppConfig): boolean {
  if (cfg.OCR_PROVIDER === 'vision') return cfg.MODEL_SUPPORTS_VISION;
  return Boolean(cfg.OCR_API_URL && cfg.OCR_API_KEY);
}
