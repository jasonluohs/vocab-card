import Dexie, { type EntityTable } from 'dexie';
import type { Card, ReviewLog } from 'ts-fsrs';

export interface AdditionalSense {
  chinese: string;
  english: string;
  example?: string;
}

export type GenerationStatus = 'pending' | 'complete' | 'failed';
export type SourceType = 'paste' | 'ocr';

export interface WordRecord {
  id: string;
  /** Display form of the word/phrase. */
  term: string;
  /** Dedup key: normalized, unique. */
  normalizedTerm: string;
  primaryChinese: string;
  primaryEnglish: string;
  exampleSentence: string;
  additionalSenses: AdditionalSense[];
  generationStatus: GenerationStatus;
  generationModel: string | null;
  generatedAt: number | null;
  /** First time added; never changed by context appends or edits. */
  addedAt: number;
  updatedAt: number;
  /** ts-fsrs card state, null until first review. */
  fsrsCard: Card | null;
  /** Round in which this word was last marked seen by random-mix mode. */
  randomSeenRound: number | null;
}

export interface ContextRecord {
  id: string;
  wordId: string;
  sentence: string;
  /** Normalized sentence, used for dedup. */
  normalizedSentence: string;
  sourceType: SourceType;
  capturedAt: number;
}

export interface ReviewLogRecord {
  id: string;
  wordId: string;
  reviewLog: ReviewLog;
}

export interface AppSettingRecord {
  key: string;
  value: unknown;
}

export class VocabDB extends Dexie {
  words!: EntityTable<WordRecord, 'id'>;
  contexts!: EntityTable<ContextRecord, 'id'>;
  reviewLogs!: EntityTable<ReviewLogRecord, 'id'>;
  appSettings!: EntityTable<AppSettingRecord, 'key'>;

  constructor() {
    super('vocab-card');
    this.version(1).stores({
      words:
        'id, &normalizedTerm, addedAt, generationStatus, randomSeenRound, fsrsCard.due',
      contexts: 'id, wordId, &[wordId+normalizedSentence]',
      reviewLogs: 'id, wordId, reviewLog.review',
      appSettings: 'key',
    });
  }
}

export const db = new VocabDB();
