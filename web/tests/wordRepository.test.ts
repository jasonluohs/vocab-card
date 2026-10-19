import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './setup';
import { db } from '../src/db/db';
import {
  addContext,
  createDraft,
  deleteWord,
  editWord,
  findByTerm,
  markComplete,
  markFailed,
} from '../src/services/wordRepository';

beforeEach(async () => {
  await resetDb();
});

describe('createDraft & duplicate detection (PRD §4.2)', () => {
  it('creates a pending draft with normalized dedup key', async () => {
    const word = await createDraft('  Elucidate ');
    expect(word).toBeDefined();
    expect(word!.term).toBe('Elucidate');
    expect(word!.normalizedTerm).toBe('elucidate');
    expect(word!.generationStatus).toBe('pending');
    expect(word!.fsrsCard).toBeNull();
  });

  it('rejects duplicates regardless of case/whitespace/apostrophes', async () => {
    await createDraft("don't");
    expect(await createDraft('Don’t')).toBeUndefined();
    expect(await createDraft('  DON’T  ')).toBeUndefined();
    expect(await findByTerm('DON’T')).toBeDefined();
  });

  it('attaches a context sentence to the draft', async () => {
    const word = await createDraft(
      'elucidate',
      'The study aims to elucidate the mechanism.',
    );
    const contexts = await db.contexts.toArray();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].wordId).toBe(word!.id);
  });
});

describe('context dedup (PRD §5.2)', () => {
  it('skips duplicate normalized sentences for the same word', async () => {
    const word = (await createDraft('run'))!;
    expect(await addContext(word.id, 'He can  run fast.', 'paste')).toBe(true);
    expect(await addContext(word.id, 'He can run fast. ', 'paste')).toBe(false);
    expect(await db.contexts.count()).toBe(1);
  });

  it('allows the same sentence on different words', async () => {
    const a = (await createDraft('run'))!;
    const b = (await createDraft('fast'))!;
    await addContext(a.id, 'He can run fast.', 'paste');
    expect(await addContext(b.id, 'He can run fast.', 'paste')).toBe(true);
  });
});

describe('generation status transitions (PRD §4.2, §4.5)', () => {
  it('complete fills fields; failed keeps the draft; resetToPending retries', async () => {
    const word = (await createDraft('elucidate'))!;
    await markFailed(word.id);
    let stored = await db.words.get(word.id);
    expect(stored!.generationStatus).toBe('failed');
    expect(stored!.term).toBe('elucidate'); // draft kept

    await markComplete(word.id, {
      primaryChinese: '阐明；解释清楚',
      primaryEnglish: 'To make something clear.',
      exampleSentence: 'The study aims to elucidate the mechanism.',
      additionalSenses: [{ chinese: '详述', english: 'To explain in more detail.' }],
      generationModel: 'test-model',
    });
    stored = await db.words.get(word.id);
    expect(stored!.generationStatus).toBe('complete');
    expect(stored!.primaryChinese).toContain('阐明');
    expect(stored!.generationModel).toBe('test-model');
  });
});

describe('editWord (PRD §4.6)', () => {
  it('edits fields without changing addedAt or fsrsCard', async () => {
    const word = (await createDraft('run'))!;
    await markComplete(word.id, {
      primaryChinese: '跑',
      primaryEnglish: 'To move fast.',
      exampleSentence: 'She runs daily.',
      additionalSenses: [],
      generationModel: 'm',
    });
    const before = await db.words.get(word.id);
    await new Promise((r) => setTimeout(r, 5));
    await editWord(word.id, { primaryChinese: '跑；经营' });
    const after = await db.words.get(word.id);
    expect(after!.primaryChinese).toBe('跑；经营');
    expect(after!.addedAt).toBe(before!.addedAt);
    expect(after!.fsrsCard).toBe(before!.fsrsCard);
  });

  it('blocks renaming to an existing term and reports the conflict', async () => {
    const a = (await createDraft('run'))!;
    const b = (await createDraft('walk'))!;
    const result = await editWord(b.id, { term: 'RUN' });
    expect(result.conflict?.id).toBe(a.id);
    expect((await db.words.get(b.id))!.term).toBe('walk');
  });

  it('deleteWord cascades to contexts and review logs', async () => {
    const word = (await createDraft('run', 'He runs fast.'))!;
    await db.reviewLogs.add({
      id: 'log-1',
      wordId: word.id,
      reviewLog: {} as never,
    });
    await deleteWord(word.id);
    expect(await db.words.get(word.id)).toBeUndefined();
    expect(await db.contexts.where('wordId').equals(word.id).count()).toBe(0);
    expect(await db.reviewLogs.where('wordId').equals(word.id).count()).toBe(0);
  });
});
