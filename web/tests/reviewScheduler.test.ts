import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './setup';
import { db } from '../src/db/db';
import type { WordRecord } from '../src/db/db';
import { buildFsrsQueue, rateWord } from '../src/services/reviewScheduler';
import { createEmptyCard, Rating, type Card } from 'ts-fsrs';

async function seed(
  id: string,
  opts: { due?: Date; reviewed?: boolean } = {},
): Promise<WordRecord> {
  const word: WordRecord = {
    id,
    term: id,
    normalizedTerm: id.toLowerCase(),
    primaryChinese: '',
    primaryEnglish: '',
    exampleSentence: '',
    additionalSenses: [],
    generationStatus: 'pending',
    generationModel: null,
    generatedAt: null,
    addedAt: Date.now(),
    updatedAt: Date.now(),
    fsrsCard: opts.reviewed ? createEmptyCard(new Date('2026-01-01')) : null,
    randomSeenRound: null,
  };
  if (opts.due) {
    const base: Card = createEmptyCard(new Date());
    word.fsrsCard = { ...base, due: opts.due };
  }
  await db.words.add(word);
  return word;
}

beforeEach(async () => {
  await resetDb();
});

describe('buildFsrsQueue (PRD §4.8)', () => {
  it('due cards come before new cards; not-yet-due cards are excluded', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const dueEarly = await seed('due-early', { reviewed: true, due: new Date('2026-10-18T10:00:00Z') });
    await seed('not-due', { reviewed: true, due: new Date('2026-11-18T00:00:00Z') });
    await seed('new-card');
    const dueLate = await seed('due-late', { reviewed: true, due: new Date('2026-10-18T11:00:00Z') });

    const queue = buildFsrsQueue(
      await db.words.toArray(),
      now,
    );
    expect(queue.due.map((w) => w.id)).toEqual([dueEarly.id, dueLate.id]);
    expect(queue.newCards.map((w) => w.id)).toEqual(['new-card']);
  });
});

describe('rateWord (PRD §4.8)', () => {
  it('认识 maps to Good and 不认识 maps to Again', async () => {
    const word = await seed('w1');
    const good = await rateWord(word, true, new Date('2026-10-18T12:00:00Z'));
    expect(good.log.rating).toBe(Rating.Good);

    const stored = (await db.words.get(word.id))!;
    const again = await rateWord(stored, false, new Date('2026-10-19T12:00:00Z'));
    expect(again.log.rating).toBe(Rating.Again);
  });

  it('persists card state and review log; new cards start scheduling', async () => {
    const word = await seed('w2');
    await rateWord(word, true, new Date('2026-10-18T12:00:00Z'));
    const stored = (await db.words.get(word.id))!;
    expect(stored.fsrsCard).not.toBeNull();
    expect(stored.fsrsCard!.reps).toBe(1);
    const logs = await db.reviewLogs.where('wordId').equals(word.id).toArray();
    expect(logs).toHaveLength(1);
  });

  it('rating Again yields an earlier next due than Good', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const a = await seed('again-word');
    const g = await seed('good-word');
    const rAgain = await rateWord(a, false, now);
    const rGood = await rateWord(g, true, now);
    expect(rAgain.card.due.getTime()).toBeLessThan(rGood.card.due.getTime());
  });
});
