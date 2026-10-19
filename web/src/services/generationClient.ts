import { z } from 'zod';

/**
 * GenerationClient: talks to the API proxy (PRD §6.4).
 * - Model keys never exist here; only the shared access code, kept in
 *   localStorage purely to avoid re-typing (PRD §4.11).
 * - Both the server and this client validate the response schema (PRD §4.5).
 */

const API_BASE = (import.meta.env.VITE_API_PROXY_URL as string | undefined) ?? '';
const ACCESS_CODE_KEY = 'vocab-card.access-code';

export function getAccessCode(): string {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAccessCode(code: string): void {
  try {
    localStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    /* storage unavailable */
  }
}

export function clearAccessCode(): void {
  try {
    localStorage.removeItem(ACCESS_CODE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly needsAccessCode = false,
  ) {
    super(message);
  }
}

const GeneratedCardSchema = z.object({
  term: z.string().min(1),
  primaryChinese: z.string().min(1),
  primaryEnglish: z.string().min(1),
  exampleSentence: z.string().min(1),
  additionalSenses: z
    .array(
      z.object({
        chinese: z.string().min(1),
        english: z.string().min(1),
        example: z.string().optional(),
      }),
    )
    .default([]),
  generationModel: z.string().default(''),
});

export type GeneratedCard = z.infer<typeof GeneratedCardSchema>;

async function request(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (!API_BASE) {
    throw new ApiError('proxy_not_configured', 0);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        'x-access-code': getAccessCode(),
      },
    });
  } catch {
    throw new ApiError('network_error', 0);
  }
  if (res.status === 401) {
    throw new ApiError('invalid_access_code', 401, true);
  }
  if (res.status === 429) {
    throw new ApiError('rate_limited', 429);
  }
  if (!res.ok) {
    throw new ApiError(`server_error_${res.status}`, res.status);
  }
  return res.json();
}

export async function generateCard(
  term: string,
  contextSentences: string[],
): Promise<GeneratedCard> {
  const raw = await request('/api/v1/generate-card', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ term, contextSentences }),
  });
  const parsed = GeneratedCardSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('invalid_model_output', 502);
  }
  return parsed.data;
}

export interface HealthInfo {
  ok: boolean;
  generationConfigured: boolean;
  ocrConfigured: boolean;
}

export async function checkHealth(): Promise<HealthInfo | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/health`);
    if (!res.ok) return null;
    return (await res.json()) as HealthInfo;
  } catch {
    return null;
  }
}
