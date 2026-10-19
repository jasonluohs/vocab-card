import {
  createDraft,
  findByTerm,
  getContexts,
  getWord,
  markComplete,
  markFailed,
  resetToPending,
} from './wordRepository';
import {
  ApiError,
  generateCard,
  type GeneratedCard,
} from './generationClient';
import type { WordRecord } from '../db/db';

/**
 * Add flow orchestration (PRD §4.2):
 * duplicate check → pending draft → generate → complete/failed.
 * A failed generation NEVER loses the draft.
 */

export type AddResult =
  | { status: 'duplicate'; word: WordRecord }
  | { status: 'invalid' }
  | { status: 'complete'; word: WordRecord }
  | { status: 'failed'; word: WordRecord; error: ApiError };

export async function addWord(
  rawTerm: string,
  contextSentence?: string,
  sourceType: 'paste' | 'ocr' = 'paste',
): Promise<AddResult> {
  const existing = await findByTerm(rawTerm);
  if (existing) return { status: 'duplicate', word: existing };

  const draft = await createDraft(rawTerm, contextSentence, sourceType);
  if (!draft) return { status: 'invalid' };

  return generateForDraft(draft, contextSentence);
}

async function generateForDraft(
  draft: WordRecord,
  contextSentence?: string,
): Promise<AddResult> {
  try {
    const card = await generateCard(
      draft.term,
      contextSentence ? [contextSentence] : [],
    );
    await applyGeneration(draft.id, card);
    const word = await getWord(draft.id);
    if (!word) return { status: 'invalid' };
    return { status: 'complete', word };
  } catch (err) {
    const apiError =
      err instanceof ApiError ? err : new ApiError('unknown_error', 0);
    await markFailed(draft.id);
    const word = await getWord(draft.id);
    if (!word) return { status: 'invalid' };
    return { status: 'failed', word, error: apiError };
  }
}

async function applyGeneration(wordId: string, card: GeneratedCard): Promise<void> {
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
}

/** Retry generation for a failed card (PRD §4.2). */
export async function retryGeneration(
  wordId: string,
): Promise<AddResult | null> {
  const word = await getWord(wordId);
  if (!word) return null;
  await resetToPending(wordId);
  // Use recorded contexts to disambiguate the sense, if any.
  const contexts = await getContexts(wordId);
  return generateForDraft(word, contexts[0]?.sentence);
}
