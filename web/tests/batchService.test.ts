import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from './setup';
import { db } from '../src/db/db';
import type { WordRecord } from '../src/db/db';

// Mock the generation client so batch logic is tested in isolation.
vi.mock('../src/services/generationClient', () => {
  class ApiError extends Error {
    status: number;
    needsAccessCode: boolean;
    constructor(message: string, status = 0, needsAccessCode = false) {
      super(message);
      this.status = status;
      this.needsAccessCode = needsAccessCode;
    }
  }
  return {
    ApiError,
    generateCard: vi.fn(),
  };
});

import { generateCard } from '../src/services/generationClient';
import {
  batchCollect,
  buildBatchGroups,
  MAX_BATCH_TERMS,
} from '../src/services/batchService';
import { createDraft, markComplete } from '../src/services/wordRepository';

const mockGenerate = vi.mocked(generateCard);

function fakeCard(term: string) {
  return {
    term,
    primaryChinese: `中文:${term}`,
    primaryEnglish: `English: ${term}`,
    exampleSentence: `${term} in a sentence.`,
    additionalSenses: [],
    generationModel: 'mock',
  };
}

const TEXT =
  'The study elucidates the method. Another study also elucidates it. Serendipity appeared later.';

async function seedExisting(term: string): Promise<WordRecord> {
  const word = (await createDraft(term))!;
  await markComplete(word.id, {
    primaryChinese: '既有',
    primaryEnglish: 'existing',
    exampleSentence: 'existing example',
    additionalSenses: [],
    generationModel: 'mock',
  });
  return word;
}

beforeEach(async () => {
  await resetDb();
  mockGenerate.mockReset();
});

describe('buildBatchGroups (PRD §4.3)', () => {
  it('groups same word occurrences and dedupes identical sentences', async () => {
    const elucidate1 = TEXT.indexOf('elucidates');
    const elucidate2 = TEXT.indexOf('elucidates', elucidate1 + 1);
    const serendipity = TEXT.indexOf('Serendipity');
    const groups = await buildBatchGroups(
      TEXT,
      [
        { term: 'elucidates', offset: elucidate1 },
        { term: 'elucidates', offset: elucidate2 },
        { term: 'Serendipity', offset: serendipity },
      ],
      (text, offset) => {
        // Simple sentence finder for the fixture text.
        for (const m of text.matchAll(/[^.]+[.]/g)) {
          if (offset >= m.index! && offset < m.index! + m[0].length) {
            return m[0].trim();
          }
        }
        return null;
      },
    );
    expect(groups).toHaveLength(2);
    const elucidate = groups.find((g) => g.term === 'elucidates')!;
    expect(elucidate.sentences).toEqual([
      'The study elucidates the method.',
      'Another study also elucidates it.',
    ]);
  });
});

describe('batchCollect (PRD §4.3)', () => {
  it('creates cards for new words and passes context sentences to the model', async () => {
    mockGenerate.mockImplementation(async (term) => fakeCard(term));
    const groups = [
      { term: 'elucidate', sentences: ['The study elucidates the method.'] },
    ];
    const outcomes: Array<{ term: string; wordId: string | null; kind: string }> = [];
    await batchCollect(groups, (o) => outcomes.push(o));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe('created');
    expect(mockGenerate).toHaveBeenCalledWith('elucidate', [
      'The study elucidates the method.',
    ]);
    const stored = await db.words.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].primaryChinese).toBe('中文:elucidate');
    const contexts = await db.contexts.toArray();
    expect(contexts).toHaveLength(1);
  });

  it('existing words only gain contexts; the model is never called', async () => {
    const existing = await seedExisting('elucidate');
    mockGenerate.mockImplementation(async (t) => fakeCard(t));
    const outcomes = await batchCollect(
      [
        {
          term: 'elucidate',
          sentences: ['Sentence A.', 'Sentence B.', 'Sentence A.'],
        },
      ],
      () => undefined,
    );
    expect(outcomes[0].kind).toBe('context');
    expect(outcomes[0].wordId).toBe(existing.id);
    expect(mockGenerate).not.toHaveBeenCalled();
    const contexts = await db.contexts
      .where('wordId')
      .equals(existing.id)
      .toArray();
    // Deduped: A, B (duplicate A dropped).
    expect(contexts.map((c) => c.sentence).sort()).toEqual([
      'Sentence A.',
      'Sentence B.',
    ]);
  });

  it('partial failure keeps successful results and failed drafts', async () => {
    mockGenerate.mockImplementation(async (term) => {
      if (term === 'serendipity') {
        throw new (await import('../src/services/generationClient')).ApiError(
          'network_error',
          0,
        );
      }
      return fakeCard(term);
    });
    const outcomes = await batchCollect(
      [
        { term: 'alpha', sentences: ['Alpha here.'] },
        { term: 'serendipity', sentences: ['Serendipity here.'] },
      ],
      () => undefined,
    );
    const created = outcomes.find((o) => o.term === 'alpha')!;
    expect(created.kind).toBe('created');
    const failed = outcomes.find((o) => o.term === 'serendipity')!;
    expect(failed.kind).toBe('failed');
    expect(failed.error).toBe('network_error');
    // Draft kept for the failed word.
    const failedWord = await db.words.where('normalizedTerm').equals('serendipity').first();
    expect(failedWord!.generationStatus).toBe('failed');
  });
});

describe('limits (PRD §4.5)', () => {
  it('MAX_BATCH_TERMS is 20', () => {
    expect(MAX_BATCH_TERMS).toBe(20);
  });
});
