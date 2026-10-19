import { addContext, createDraft, findByTerm, getContexts, getWord, markComplete, markFailed } from './wordRepository';
import { ApiError, generateCard } from './generationClient';
import { normalizeSentence, normalizeTerm } from '../db/normalize';
import type { WordRecord } from '../db/db';

/**
 * Batch collect from pasted/OCR text (PRD §4.3–4.4).
 * - Same word in multiple positions → one card, several distinct contexts.
 * - Existing card → only append new contexts, never regenerate.
 * - New card → draft + independent generation; partial success allowed.
 * - Client-side concurrency limit: 3 (PRD §4.5).
 */

export interface BatchEntryInput {
  /** Raw token text as selected. */
  term: string;
  /** Character offset of this occurrence in the source text. */
  offset: number;
}

export interface BatchOutcome {
  term: string;
  wordId: string | null;
  /** created = new card generated; context = only contexts appended; failed = generation failed. */
  kind: 'created' | 'context' | 'failed';
  error?: string;
}

export const MAX_BATCH_TERMS = 20;
export const MAX_CONCURRENCY = 3;

/** Group selected entries by normalized term, keeping distinct sentences. */
export async function buildBatchGroups(
  sourceText: string,
  entries: BatchEntryInput[],
  sentenceAtFn: (text: string, offset: number) => string | null,
): Promise<Array<{ term: string; sentences: string[] }>> {
  const groups = new Map<string, { term: string; sentences: Set<string> }>();
  for (const entry of entries) {
    const normalized = normalizeTerm(entry.term);
    if (!normalized) continue;
    let group = groups.get(normalized);
    if (!group) {
      group = { term: entry.term, sentences: new Set() };
      groups.set(normalized, group);
    }
    const sentence = sentenceAtFn(sourceText, entry.offset);
    if (sentence) group.sentences.add(normalizeSentence(sentence));
  }
  return Array.from(groups.values(), (g) => ({
    term: g.term,
    sentences: Array.from(g.sentences),
  }));
}

async function processGroup(
  term: string,
  sentences: string[],
  sourceType: 'paste' | 'ocr',
): Promise<BatchOutcome> {
  try {
    const existing = await findByTerm(term);
    if (existing) {
      // Existing card: append new contexts only (PRD §4.3).
      for (const sentence of sentences) {
        await addContext(existing.id, sentence, sourceType);
      }
      return { term, wordId: existing.id, kind: 'context' };
    }

    // The unique normalizedTerm index can turn the check-then-add into a
    // ConstraintError under concurrency — treat it as a duplicate.
    let draft: Awaited<ReturnType<typeof createDraft>>;
    try {
      draft = await createDraft(term, sentences[0], sourceType);
    } catch (err) {
      if ((err as { name?: string }).name === 'ConstraintError') {
        const raced = await findByTerm(term);
        if (raced) {
          for (const sentence of sentences) {
            await addContext(raced.id, sentence, sourceType);
          }
          return { term, wordId: raced.id, kind: 'context' };
        }
      }
      throw err;
    }
    if (!draft) return { term, wordId: null, kind: 'failed', error: 'invalid_term' };

  try {
    const card = await generateCard(draft.term, sentences.slice(0, 5));
    await markComplete(draft.id, {
      primaryChinese: card.primaryChinese,
      primaryEnglish: card.primaryEnglish,
      exampleSentence: card.exampleSentence,
      additionalSenses: card.additionalSenses.map((s) => ({
        chinese: s.chinese,
        english: s.english,
        ...(s.example ? { example: s.example } : {}),
      })),
      generationModel: card.generationModel,
    });
    // Any further distinct sentences beyond the first.
    for (const sentence of sentences.slice(1)) {
      await addContext(draft.id, sentence, sourceType);
    }
    return { term, wordId: draft.id, kind: 'created' };
  } catch (err) {
    const apiError = err instanceof ApiError ? err : new ApiError('unknown', 0);
    await markFailed(draft.id);
    return { term, wordId: draft.id, kind: 'failed', error: apiError.message };
  }
  } catch (err) {
    // Any unexpected failure (DB full, etc.) becomes a per-word failed
    // outcome instead of killing the whole batch (review finding #6).
    if (err instanceof ApiError) {
      return { term, wordId: null, kind: 'failed', error: err.message };
    }
    return { term, wordId: null, kind: 'failed', error: 'storage_error' };
  }
}

/** Run all groups with the concurrency limit; report each outcome as it lands. */
export async function batchCollect(
  groups: Array<{ term: string; sentences: string[] }>,
  onOutcome: (outcome: BatchOutcome) => void,
  sourceType: 'paste' | 'ocr' = 'paste',
): Promise<BatchOutcome[]> {
  const outcomes: BatchOutcome[] = [];
  const queue = [...groups];
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const group = queue.shift();
        if (!group) return;
        const outcome = await processGroup(group.term, group.sentences, sourceType);
        outcomes.push(outcome);
        onOutcome(outcome);
      }
    },
  );
  await Promise.all(workers);
  return outcomes;
}

/** Retry a single failed batch item (PRD §4.3: per-item retry). */
export async function retryBatchItem(
  wordId: string,
): Promise<BatchOutcome | null> {
  const word: WordRecord | undefined = await getWord(wordId);
  if (!word) return null;
  const contexts = await getContexts(wordId);
  try {
    const card = await generateCard(
      word.term,
      contexts.slice(0, 5).map((c) => c.sentence),
    );
    await markComplete(wordId, {
      primaryChinese: card.primaryChinese,
      primaryEnglish: card.primaryEnglish,
      exampleSentence: card.exampleSentence,
      additionalSenses: card.additionalSenses.map((s) => ({
        chinese: s.chinese,
        english: s.english,
        ...(s.example ? { example: s.example } : {}),
      })),
      generationModel: card.generationModel,
    });
    return { term: word.term, wordId, kind: 'created' };
  } catch (err) {
    const apiError = err instanceof ApiError ? err : new ApiError('unknown', 0);
    await markFailed(wordId);
    return { term: word.term, wordId, kind: 'failed', error: apiError.message };
  }
}
