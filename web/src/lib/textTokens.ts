/**
 * Text tokenization and sentence extraction for the paste/OCR flows
 * (PRD §4.3–4.4).
 */

export interface TextPart {
  text: string;
  kind: 'plain' | 'token';
  /** Character offset in the original text. */
  start: number;
  end: number;
}

const TOKEN_RE = /[A-Za-z][A-Za-z\u2019'-]*/g;

/**
 * Split text into plain and English-token parts, preserving all
 * characters (paragraphs, punctuation) and recording offsets.
 */
export function tokenizeText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index!;
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), kind: 'plain', start: cursor, end: start });
    }
    parts.push({ text: match[0], kind: 'token', start, end: start + match[0].length });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), kind: 'plain', start: cursor, end: text.length });
  }
  return parts;
}

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  } catch {
    segmenter = null;
  }
  return segmenter;
}

function segmentSentences(text: string): SentenceSpan[] {
  const seg = getSegmenter();
  if (seg) {
    return Array.from(seg.segment(text), (s) => ({
      text: s.segment,
      start: s.index,
      end: s.index + s.segment.length,
    }));
  }
  // Fallback: split on sentence-ending punctuation, keeping it attached.
  const spans: SentenceSpan[] = [];
  const re = /[^.!?…\n]+[.!?…]*\s*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m[0].trim().length > 0) {
      spans.push({
        text: m[0],
        start: m.index!,
        end: m.index! + m[0].length,
      });
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) {
    spans.push({ text: text.slice(last), start: last, end: text.length });
  }
  return spans;
}

/**
 * Extract the sentence containing the character offset (a token start),
 * trimmed of surrounding whitespace (PRD §4.3).
 */
export function sentenceAt(text: string, offset: number): string | null {
  const spans = segmentSentences(text);
  const hit = spans.find((s) => offset >= s.start && offset < s.end);
  if (hit) return hit.text.trim() || null;
  // Offsets beyond the last span (should not happen): closest span.
  const last = spans.at(-1);
  return last ? last.text.trim() || null : null;
}
