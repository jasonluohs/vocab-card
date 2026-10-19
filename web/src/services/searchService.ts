import Fuse from 'fuse.js';
import type { ContextRecord, WordRecord } from '../db/db';
import { normalizeTerm } from '../db/normalize';

/**
 * SearchService: local fuzzy search over saved cards (PRD §4.7).
 * Ordering: English exact → prefix → substring → Chinese defs →
 * English def/example/contexts → Fuse fuzzy (only for queries > 2 chars).
 * One card appears at most once.
 */

export interface SearchHit {
  wordId: string;
  term: string;
  primaryChinese: string;
}

export interface SearchDoc {
  wordId: string;
  term: string;
  normalizedTerm: string;
  primaryChinese: string;
  sensesChinese: string;
  primaryEnglish: string;
  exampleSentence: string;
  contextsText: string;
}

export function buildSearchDocs(
  words: WordRecord[],
  contexts: ContextRecord[],
): SearchDoc[] {
  const contextsByWord = new Map<string, string[]>();
  for (const ctx of contexts) {
    const list = contextsByWord.get(ctx.wordId) ?? [];
    list.push(ctx.sentence);
    contextsByWord.set(ctx.wordId, list);
  }
  return words.map((w) => ({
    wordId: w.id,
    term: w.term,
    normalizedTerm: w.normalizedTerm,
    primaryChinese: w.primaryChinese,
    sensesChinese: w.additionalSenses.map((s) => s.chinese).join('\n'),
    primaryEnglish: w.primaryEnglish,
    exampleSentence: w.exampleSentence,
    contextsText: (contextsByWord.get(w.id) ?? []).join('\n'),
  }));
}

function normalizeQuery(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function searchDocs(docs: SearchDoc[], rawQuery: string): SearchHit[] {
  const query = normalizeQuery(rawQuery);
  if (!query) return [];

  const lowerQuery = query.toLowerCase();
  const ordered: SearchDoc[] = [];
  const seen = new Set<string>();

  const push = (doc: SearchDoc) => {
    if (!seen.has(doc.wordId)) {
      seen.add(doc.wordId);
      ordered.push(doc);
    }
  };

  // 1. Exact normalized term match.
  for (const doc of docs) {
    if (doc.normalizedTerm === normalizeTerm(query)) push(doc);
  }
  // 2. Prefix match.
  for (const doc of docs) {
    if (doc.normalizedTerm.startsWith(lowerQuery)) push(doc);
  }
  // 3. Substring match on the term.
  for (const doc of docs) {
    if (doc.normalizedTerm.includes(lowerQuery)) push(doc);
  }
  // 4. Chinese definitions (primary + other senses), substring.
  for (const doc of docs) {
    if (
      doc.primaryChinese.includes(query) ||
      doc.sensesChinese.includes(query)
    ) {
      push(doc);
    }
  }
  // 5. English definition, example and historical contexts, substring.
  for (const doc of docs) {
    const hay = `${doc.primaryEnglish}\n${doc.exampleSentence}\n${doc.contextsText}`.toLowerCase();
    if (hay.includes(lowerQuery)) push(doc);
  }
  // 6. Fuzzy match — only for queries longer than 2 chars (PRD §4.7).
  if (query.length > 2) {
    const fuse = new Fuse(docs, {
      keys: [
        { name: 'term', weight: 0.5 },
        { name: 'primaryChinese', weight: 0.25 },
        { name: 'primaryEnglish', weight: 0.15 },
        { name: 'exampleSentence', weight: 0.05 },
        { name: 'contextsText', weight: 0.05 },
      ],
      threshold: 0.4,
      minMatchCharLength: 3,
      ignoreLocation: true,
    });
    for (const result of fuse.search(query)) {
      push(result.item);
    }
  }

  return ordered.map((doc) => ({
    wordId: doc.wordId,
    term: doc.term,
    primaryChinese: doc.primaryChinese,
  }));
}
