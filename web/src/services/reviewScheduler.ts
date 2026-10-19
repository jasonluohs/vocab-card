import {
  createEmptyCard,
  fsrs,
  Rating,
  type Card,
  type ReviewLog,
} from 'ts-fsrs';
import { db } from '../db/db';
import type { WordRecord } from '../db/db';
import { uuid } from '../lib/id';

/**
 * ReviewScheduler: FSRS mode logic (PRD §4.8).
 * Default ts-fsrs parameters; no user tuning in MVP.
 * 认识 → Rating.Good, 不认识 → Rating.Again.
 */

const scheduler = fsrs();

export interface FsrsQueue {
  /** Cards whose due time has passed, earliest first. */
  due: WordRecord[];
  /** Cards that have never been rated (New). */
  newCards: WordRecord[];
}

/**
 * Build the FSRS review queue: due cards first, then new cards (PRD §4.8).
 * Cards that have a card state but are not yet due are excluded.
 */
export function buildFsrsQueue(
  words: WordRecord[],
  now: Date = new Date(),
): FsrsQueue {
  const due: WordRecord[] = [];
  const newCards: WordRecord[] = [];
  for (const word of words) {
    if (!word.fsrsCard) {
      newCards.push(word);
    } else if (word.fsrsCard.due.getTime() <= now.getTime()) {
      due.push(word);
    }
  }
  due.sort((a, b) => a.fsrsCard!.due.getTime() - b.fsrsCard!.due.getTime());
  return { due, newCards };
}

/** True if the word is currently learnable in FSRS mode. */
export function isFsrsEligible(word: WordRecord, now: Date = new Date()): boolean {
  if (!word.fsrsCard) return true;
  return word.fsrsCard.due.getTime() <= now.getTime();
}

export interface RateResult {
  card: Card;
  log: ReviewLog;
}

/**
 * Apply a review rating to a word. New cards start scheduling on first
 * feedback; the new card state and review log are persisted atomically.
 */
export async function rateWord(
  word: WordRecord,
  known: boolean,
  now: Date = new Date(),
): Promise<RateResult> {
  // Note: an explicit annotation is required — generic inference through
  // `??` would otherwise infer R = Card | null from the left operand.
  const emptyCard: Card = createEmptyCard(now);
  const currentCard = word.fsrsCard ?? emptyCard;
  const rating = known ? Rating.Good : Rating.Again;
  const schedules = scheduler.repeat(currentCard, now);
  const { card, log } = schedules[rating];

  await db.transaction('rw', db.words, db.reviewLogs, async () => {
    await db.words.update(word.id, {
      fsrsCard: card,
      updatedAt: Date.now(),
    });
    await db.reviewLogs.add({
      id: uuid(),
      wordId: word.id,
      reviewLog: log,
    });
  });

  return { card, log };
}
