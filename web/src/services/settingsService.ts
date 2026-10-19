import { db } from '../db/db';

/**
 * Typed key-value settings persisted in IndexedDB (PRD §5.4).
 * Shared access code lives in localStorage, NOT here.
 */

export type BrowseMode = 'random' | 'time' | 'fsrs';
export type TimeOrderDirection = 'oldToNew' | 'newToOld';

export interface ModePositions {
  random: { currentWordId: string | null };
  time: { currentWordId: string | null };
  fsrs: { currentWordId: string | null };
}

export interface AppSettingsState {
  lastMode: BrowseMode;
  /** Random-mix ratio: probability (0-1) of picking unseen-in-round words. */
  unseenRatio: number;
  randomRound: number;
  timeDirection: TimeOrderDirection;
  positions: ModePositions;
}

export const DEFAULT_SETTINGS: AppSettingsState = {
  lastMode: 'random',
  unseenRatio: 0.7,
  randomRound: 1,
  timeDirection: 'newToOld',
  positions: {
    random: { currentWordId: null },
    time: { currentWordId: null },
    fsrs: { currentWordId: null },
  },
};

const SETTINGS_KEY = 'appSettings';

export async function loadSettings(): Promise<AppSettingsState> {
  const record = await db.appSettings.get(SETTINGS_KEY);
  if (!record) return { ...DEFAULT_SETTINGS };
  // Shallow-merge over defaults so new fields get default values on upgrade.
  const saved = record.value as Partial<AppSettingsState>;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    positions: { ...DEFAULT_SETTINGS.positions, ...(saved.positions ?? {}) },
  };
}

export async function saveSettings(
  patch: Partial<AppSettingsState>,
): Promise<void> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await db.appSettings.put({ key: SETTINGS_KEY, value: next });
}

export function isValidMode(value: string): value is BrowseMode {
  return value === 'random' || value === 'time' || value === 'fsrs';
}
