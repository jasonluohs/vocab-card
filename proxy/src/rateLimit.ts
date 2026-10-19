/**
 * In-memory per-IP rate limiter (PRD §6.3).
 * Good enough for a single-instance personal proxy; the limiter runs
 * server-side so client button debounce is never the only protection.
 */

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number = 60_000,
  ) {}

  /** Record a hit; returns false when the caller exceeded the limit. */
  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
