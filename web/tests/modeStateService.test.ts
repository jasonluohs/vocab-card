import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from './setup';
import { db } from '../src/db/db';
import type { WordRecord } from '../src/db/db';
import {
  pickRandom,
  saveModePosition,
  sortTimeOrder,
  timeNeighbor,
} from '../src/services/modeStateService';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from '../src/services/settingsService';

let seq = 0;
async function seedWord(term: string): Promise<WordRecord> {
  const w = await db.words.add({
    id: `w-${term}`,
    term,
    normalizedTerm: term.toLowerCase(),
    primaryChinese: '',
    primaryEnglish: '',
    exampleSentence: '',
    additionalSenses: [],
    generationStatus: 'pending',
    generationModel: null,
    generatedAt: null,
    addedAt: ++seq,
    updatedAt: seq,
    fsrsCard: null,
    randomSeenRound: null,
  });
  return (await db.words.get(w))!;
}

beforeEach(async () => {
  await resetDb();
  seq = 0;
});

describe('time order mode (PRD §4.10)', () => {
  it('sorts old→new and new→old', async () => {
    const a = await seedWord('alpha');
    const b = await seedWord('beta');
    const c = await seedWord('gamma');
    const words = [a, b, c];
    expect(sortTimeOrder(words, 'oldToNew').map((w) => w.term)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(sortTimeOrder(words, 'newToOld').map((w) => w.term)).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);
  });

  it('steps in strict order and stops at boundaries without wrapping', () => {
    const ordered = [
      { ...({} as WordRecord), id: 'a', addedAt: 1 },
      { ...({} as WordRecord), id: 'b', addedAt: 2 },
      { ...({} as WordRecord), id: 'c', addedAt: 3 },
    ];
    expect(timeNeighbor(ordered, 'oldToNew', 'a', 1)?.id).toBe('b');
    expect(timeNeighbor(ordered, 'oldToNew', 'c', 1)).toBeNull();
    expect(timeNeighbor(ordered, 'oldToNew', 'a', -1)).toBeNull();
    expect(timeNeighbor(ordered, 'newToOld', 'c', 1)?.id).toBe('b');
  });

  it('recovers when the current word is missing', () => {
    const ordered = [
      { ...({} as WordRecord), id: 'a', addedAt: 1 },
      { ...({} as WordRecord), id: 'b', addedAt: 2 },
    ];
    expect(timeNeighbor(ordered, 'oldToNew', 'gone', 1)?.id).toBe('a');
    expect(timeNeighbor(ordered, 'oldToNew', 'gone', -1)?.id).toBe('b');
  });
});

describe('random mix mode (PRD §4.9)', () => {
  it('picks from the unseen pool with the given ratio', async () => {
    const words = [await seedWord('a'), await seedWord('b')];
    const settings = { ...DEFAULT_SETTINGS, unseenRatio: 1.0, randomRound: 1 };
    const result = pickRandom(words, settings, null)!;
    expect(result.word).toBeDefined();
    expect(result.startedNewRound).toBe(false);
  });

  it('falls back to the other pool when the chosen pool is empty', async () => {
    const a = await seedWord('a');
    const b = await seedWord('b');
    const words = [a, b];
    // Ratio 100% unseen, but everything already seen this round.
    const settings = { ...DEFAULT_SETTINGS, unseenRatio: 1.0, randomRound: 1 };
    const seen = words.map((w) => ({ ...w, randomSeenRound: 1 }));
    const result = pickRandom(seen, settings, null)!;
    // All seen → new round starts, unseen pool becomes all words.
    expect(result.startedNewRound).toBe(true);
  });

  it('starts a new round when every card has been seen', async () => {
    const words = [await seedWord('a'), await seedWord('b')];
    const allSeen = words.map((w) => ({ ...w, randomSeenRound: 1 }));
    const settings = { ...DEFAULT_SETTINGS, randomRound: 1 };
    const result = pickRandom(allSeen, settings, null)!;
    expect(result.startedNewRound).toBe(true);
  });

  it('avoids repeating the last shown card when possible', async () => {
    const words = [await seedWord('a'), await seedWord('b')];
    const settings = { ...DEFAULT_SETTINGS, unseenRatio: 1.0, randomRound: 1 };
    for (let i = 0; i < 20; i++) {
      const result = pickRandom(words, settings, 'w-a')!;
      expect(result.word.id).toBe('w-b');
    }
  });

  it('single-card library may repeat the card', async () => {
    const words = [await seedWord('only')];
    const settings = { ...DEFAULT_SETTINGS, randomRound: 1 };
    const result = pickRandom(words, settings, 'w-only')!;
    expect(result.word.id).toBe('w-only');
  });

  it('never picks when the library is empty', () => {
    expect(pickRandom([], DEFAULT_SETTINGS, null)).toBeNull();
  });
});

describe('per-mode position isolation (PRD §4.9–4.11)', () => {
  it('saves and restores independent positions per mode', async () => {
    await saveModePosition('random', 'r1');
    await saveModePosition('time', 't1');
    await saveModePosition('fsrs', 'f1');
    const settings = await loadSettings();
    expect(settings.positions.random.currentWordId).toBe('r1');
    expect(settings.positions.time.currentWordId).toBe('t1');
    expect(settings.positions.fsrs.currentWordId).toBe('f1');

    // Changing one mode does not touch the others.
    await saveModePosition('random', 'r2');
    const next = await loadSettings();
    expect(next.positions.random.currentWordId).toBe('r2');
    expect(next.positions.time.currentWordId).toBe('t1');
    expect(next.positions.fsrs.currentWordId).toBe('f1');
  });

  it('persists ratio, round, direction and last mode', async () => {
    await saveSettings({
      unseenRatio: 0.5,
      randomRound: 3,
      timeDirection: 'oldToNew',
      lastMode: 'time',
    });
    const s = await loadSettings();
    expect(s.unseenRatio).toBe(0.5);
    expect(s.randomRound).toBe(3);
    expect(s.timeDirection).toBe('oldToNew');
    expect(s.lastMode).toBe('time');
  });

  it('mocked random 0 picks the first unseen card deterministically', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const words = [await seedWord('a'), await seedWord('b')];
    const settings = { ...DEFAULT_SETTINGS, unseenRatio: 0.7, randomRound: 1 };
    const result = pickRandom(words, settings, null)!;
    expect(result.word.id).toBe('w-a');
    spy.mockRestore();
  });
});
