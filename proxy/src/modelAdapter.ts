import type { AppConfig } from './config.js';

/**
 * OpenAI-compatible Chat Completions adapter (PRD §7.2).
 * All upstream differences are isolated here.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTextMessage {
  role: ChatRole;
  content: string;
}

export interface ChatImageMessage {
  role: 'user';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
}

export type ChatMessage = ChatTextMessage | ChatImageMessage;

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
  ) {
    super(message);
  }
}

interface ChatResponseChoice {
  message?: { content?: string | null };
}

export async function callChatCompletions(
  cfg: AppConfig,
  messages: ChatMessage[],
  opts: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<string> {
  const base = cfg.MODEL_BASE_URL.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 90_000,
  );
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.MODEL_API_KEY}`,
      },
      body: JSON.stringify({
        model: cfg.MODEL_NAME,
        messages,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new UpstreamError(
        `upstream_error_${res.status}`,
        res.status >= 500 ? 502 : 502,
      );
    }
    const data = (await res.json()) as { choices?: ChatResponseChoice[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new UpstreamError('empty_model_response');
    }
    return content;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UpstreamError('upstream_timeout', 504);
    }
    throw new UpstreamError('upstream_unreachable', 502);
  } finally {
    clearTimeout(timer);
  }
}
