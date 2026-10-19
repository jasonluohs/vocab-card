/**
 * Normalization helpers for terms and sentences (PRD §5.5).
 *
 * Rules:
 * - English term matching is case-insensitive.
 * - Trim, collapse consecutive whitespace to a single space.
 * - Normalize curly/single-quote variants to a plain apostrophe.
 * - No stemming: `run` and `running` are different cards.
 */

const APOSTROPHE_VARIANTS = /[\u2018\u2019\u02BC\u201B\u2032]/g;

export function normalizeTerm(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Display form: normalized whitespace/quotes, but keeps original casing. */
export function displayTerm(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a context sentence for dedup: NFC + whitespace collapse + trim. */
export function normalizeSentence(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}
