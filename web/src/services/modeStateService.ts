import {
  loadSettings,
  saveSettings,
  type AppSettingsState,
  type TimeOrderDirection,
} from './settingsService';
import { db } from '../db/db';
import type { WordRecord } from '../db/db';

/**
 * ModeStateService: pure selection logic for the three browse modes
 * (PRD §4.8–4.10). Random/time browsing NEVER touches FSRS state.
 */

// ---------------------------------------------------------------- time order

export function sortTimeOrder(
  words: WordRecord[],
  direction: TimeOrderDirection,
): WordRecord[] {
  const sorted = [...words].sort((a, b) => a.addedAt - b.addedAt);
  return direction === 'oldToNew' ? sorted : sorted.reverse();
}

/**
 * Neighbor in strict time order; stops at boundaries without wrapping
 * (PRD §4.10). Returns null at the boundary or when current word is gone
 * and no neighbor exists.
 */
export function timeNeighbor(
  words: WordRecord[],
  direction: TimeOrderDirection,
  currentWordId: string | null,
  step: 1 | -1,
): WordRecord | null {
  if (words.length === 0) return null;
  const ordered = sortTimeOrder(words, direction);
  let index = ordered.findIndex((w) => w.id === currentWordId);
  if (index === -1) {
    // Current word missing: fall back to a sensible neighbor.
    index = step === 1 ? -1 : ordered.length;
  }
  const next = index + step;
  if (next < 0 || next >= ordered.length) return null;
  return ordered[next];
}

// ---------------------------------------------------------------- random mix

export interface RandomPickResult {
  word: WordRecord;
  /** True when this pick started a new round (all cards had been seen). */
  startedNewRound: boolean;
}

/**
 * Pick one card for random-mix mode (PRD §4.9).
 *
 * - With probability unseenRatio pick from the unseen-this-round pool,
 *   otherwise from the seen pool; empty pool falls back to the other.
 * - Avoid repeating lastShownId when other options exist.
 * - When every card is seen, a pick starts a new round first.
 * - A single-card library may repeat that card.
 */
export function pickRandom(
  words: WordRecord[],
  settings: AppSettingsState,
  lastShownId: string | null,
): RandomPickResult | null {
  if (words.length === 0) return null;

  let round = settings.randomRound;
  let unseen = words.filter((w) => w.randomSeenRound !== round);
  let seen = words.filter((w) => w.randomSeenRound === round);
  let startedNewRound = false;

  if (unseen.length === 0) {
    // All cards seen: start a new round on this pick (PRD §4.9).
    round += 1;
    startedNewRound = true;
    unseen = words;
    seen = [];
  }

  const useUnseen =
    seen.length === 0 || (unseen.length > 0 && Math.random() < settings.unseenRatio);
  const primary = useUnseen ? unseen : seen;
  const fallback = useUnseen ? seen : unseen;
  const pool = primary.length > 0 ? primary : fallback;

  let word = pickAvoiding(pool, lastShownId);
  return { word, startedNewRound };
}

function pickAvoiding(pool: WordRecord[], avoidId: string | null): WordRecord {
  if (pool.length === 1) return pool[0];
  const candidates = avoidId ? pool.filter((w) => w.id !== avoidId) : pool;
  const source = candidates.length > 0 ? candidates : pool;
  return source[Math.floor(Math.random() * source.length)];
}

/** Mark a word as seen in the current random round (immediately on display). */
export async function markRandomSeen(wordId: string, round: number): Promise<void> {
  await db.words.update(wordId, { randomSeenRound: round });
}

// ------------------------------------------------------- position persistence

/** Save the current card id for one mode (positions are per-mode). */
export async function saveModePosition(
  mode: 'random' | 'time' | 'fsrs',
  wordId: string | null,
): Promise<void> {
  const current = await loadSettings();
  await saveSettings({
    positions: {
      ...current.positions,
      [mode]: { currentWordId: wordId },
    },
  });
}

/** Resolve the restored word for a mode; null if missing/no cards. */
export function resolveRestoredWord(
  words: WordRecord[],
  wordId: string | null,
): WordRecord | null {
  if (!wordId) return null;
  return words.find((w) => w.id === wordId) ?? null;
}
