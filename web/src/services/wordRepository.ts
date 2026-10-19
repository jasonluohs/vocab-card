import { db } from '../db/db';
import type { AdditionalSense, ContextRecord, WordRecord } from '../db/db';
import { normalizeSentence, normalizeTerm, displayTerm } from '../db/normalize';
import { uuid } from '../lib/id';

/**
 * WordRepository: the only module that writes word/context records.
 * All UI and mode logic goes through these functions.
 */

export async function findByNormalizedTerm(
  normalizedTerm: string,
): Promise<WordRecord | undefined> {
  return db.words.where('normalizedTerm').equals(normalizedTerm).first();
}

/** Find an existing card by raw term text (normalization applied here). */
export async function findByTerm(raw: string): Promise<WordRecord | undefined> {
  return findByNormalizedTerm(normalizeTerm(raw));
}

/**
 * Create a pending draft card for a new term.
 * Returns undefined if the term already exists (caller should open the
 * existing card instead, per PRD §4.2).
 */
export async function createDraft(
  rawTerm: string,
  contextSentence?: string,
  sourceType: ContextRecord['sourceType'] = 'paste',
): Promise<WordRecord | undefined> {
  const term = displayTerm(rawTerm);
  const normalized = normalizeTerm(rawTerm);
  if (!normalized) return undefined;

  const existing = await findByNormalizedTerm(normalized);
  if (existing) return undefined;

  const now = Date.now();
  const word: WordRecord = {
    id: uuid(),
    term,
    normalizedTerm: normalized,
    primaryChinese: '',
    primaryEnglish: '',
    exampleSentence: '',
    additionalSenses: [],
    generationStatus: 'pending',
    generationModel: null,
    generatedAt: null,
    addedAt: now,
    updatedAt: now,
    fsrsCard: null,
    randomSeenRound: null,
  };
  await db.words.add(word);
  if (contextSentence) {
    await addContext(word.id, contextSentence, sourceType);
  }
  return word;
}

export async function getWord(id: string): Promise<WordRecord | undefined> {
  return db.words.get(id);
}

export async function markComplete(
  id: string,
  fields: {
    primaryChinese: string;
    primaryEnglish: string;
    exampleSentence: string;
    additionalSenses: AdditionalSense[];
    generationModel: string;
  },
): Promise<void> {
  await db.words.update(id, {
    ...fields,
    generationStatus: 'complete',
    generatedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function markFailed(id: string): Promise<void> {
  await db.words.update(id, {
    generationStatus: 'failed',
    updatedAt: Date.now(),
  });
}

/** Reset a failed card back to pending (used by "retry generation"). */
export async function resetToPending(id: string): Promise<void> {
  await db.words.update(id, {
    generationStatus: 'pending',
    updatedAt: Date.now(),
  });
}

export interface EditableWordFields {
  term?: string;
  primaryChinese?: string;
  primaryEnglish?: string;
  exampleSentence?: string;
  additionalSenses?: AdditionalSense[];
}

/**
 * Edit word fields. Never changes addedAt or FSRS state (PRD §4.6).
 * If the new term collides with another existing card, returns the conflicting
 * card so the UI can ask the user to resolve it.
 */
export async function editWord(
  id: string,
  fields: EditableWordFields,
): Promise<{ conflict?: WordRecord }> {
  const word = await db.words.get(id);
  if (!word) return {};

  const patch: Partial<WordRecord> = { updatedAt: Date.now() };

  if (fields.term !== undefined) {
    const normalized = normalizeTerm(fields.term);
    if (normalized !== word.normalizedTerm) {
      const existing = await findByNormalizedTerm(normalized);
      if (existing) return { conflict: existing };
      patch.term = displayTerm(fields.term);
      patch.normalizedTerm = normalized;
    }
  }
  if (fields.primaryChinese !== undefined)
    patch.primaryChinese = fields.primaryChinese;
  if (fields.primaryEnglish !== undefined)
    patch.primaryEnglish = fields.primaryEnglish;
  if (fields.exampleSentence !== undefined)
    patch.exampleSentence = fields.exampleSentence;
  if (fields.additionalSenses !== undefined)
    patch.additionalSenses = fields.additionalSenses;

  await db.words.update(id, patch);
  return {};
}

/**
 * Delete a card and cascade: contexts, FSRS state, review logs,
 * random-round markers are removed with it (PRD §4.6).
 */
export async function deleteWord(id: string): Promise<void> {
  await db.transaction('rw', db.words, db.contexts, db.reviewLogs, async () => {
    await db.contexts.where('wordId').equals(id).delete();
    await db.reviewLogs.where('wordId').equals(id).delete();
    await db.words.delete(id);
  });
}

/**
 * Append a context sentence to a word, skipping duplicates
 * (normalized sentence compared per PRD §5.2). Returns true if inserted.
 */
export async function addContext(
  wordId: string,
  sentence: string,
  sourceType: ContextRecord['sourceType'],
): Promise<boolean> {
  const normalized = normalizeSentence(sentence);
  if (!normalized) return false;

  const dup = await db.contexts
    .where('[wordId+normalizedSentence]')
    .equals([wordId, normalized])
    .first();
  if (dup) return false;

  await db.contexts.add({
    id: uuid(),
    wordId,
    sentence: normalized,
    normalizedSentence: normalized,
    sourceType,
    capturedAt: Date.now(),
  });
  return true;
}

export async function getContexts(wordId: string): Promise<ContextRecord[]> {
  return db.contexts.where('wordId').equals(wordId).toArray();
}

export async function deleteContext(id: string): Promise<void> {
  await db.contexts.delete(id);
}

export async function listAllWords(): Promise<WordRecord[]> {
  return db.words.toArray();
}

export async function countWords(): Promise<number> {
  return db.words.count();
}
