import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import WordCard from '../components/WordCard';
import EmptyState from '../components/EmptyState';
import EditWordSheet from '../components/EditWordSheet';
import {
  loadSettings,
  saveSettings,
  type AppSettingsState,
  type BrowseMode,
} from '../services/settingsService';
import {
  markRandomSeen,
  pickRandom,
  resolveRestoredWord,
  saveModePosition,
  sortTimeOrder,
  timeNeighbor,
} from '../services/modeStateService';
import { buildFsrsQueue, rateWord } from '../services/reviewScheduler';
import { db } from '../db/db';
import type { WordRecord } from '../db/db';

const MODE_LABELS: Record<BrowseMode, string> = {
  random: '随机混合',
  time: '时间顺序',
  fsrs: 'FSRS 复习',
};

interface HomeViewProps {
  onNavigate: (view: 'home' | 'add' | 'search' | 'settings') => void;
  previewWordId: string | null;
  onClearPreview: () => void;
}

export default function HomeView({
  onNavigate,
  previewWordId,
  onClearPreview,
}: HomeViewProps) {
  const [settings, setSettings] = useState<AppSettingsState | null>(null);
  const [currentWord, setCurrentWord] = useState<WordRecord | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [fsrsFinished, setFsrsFinished] = useState(false);
  const [editing, setEditing] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const words = useLiveQuery(() => db.words.toArray(), [], undefined);

  const mode = settings?.lastMode ?? 'random';

  // A card opened from Add/Search is shown as-is without touching the
  // current mode position or the random seen-marker (PRD §4.1).
  const previewWord = previewWordId && words
    ? words.find((w) => w.id === previewWordId) ?? null
    : null;
  const displayWord = previewWord ?? currentWord;

  // ------------------------------------------------------------------ loading

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  /** Restore (or freshly pick) the card for the current mode. */
  const restoreForMode = useCallback(
    (s: AppSettingsState, allWords: WordRecord[]) => {
      setFlipped(false);
      setFsrsFinished(false);
      if (allWords.length === 0) {
        setCurrentWord(null);
        return;
      }
      const m = s.lastMode;
      if (m === 'random') {
        const restored = resolveRestoredWord(
          allWords,
          s.positions.random.currentWordId,
        );
        if (restored) {
          setCurrentWord(restored);
        } else {
          void pickNextRandom(s, allWords, null);
        }
      } else if (m === 'time') {
        const ordered = sortTimeOrder(allWords, s.timeDirection);
        const restored = resolveRestoredWord(
          allWords,
          s.positions.time.currentWordId,
        );
        setCurrentWord(restored ?? ordered[0] ?? null);
      } else {
        const restored = resolveRestoredWord(
          allWords,
          s.positions.fsrs.currentWordId,
        );
        if (restored && isEligible(restored)) {
          setCurrentWord(restored);
        } else {
          const queue = buildFsrsQueue(allWords);
          const next = queue.due[0] ?? queue.newCards[0] ?? null;
          setCurrentWord(next);
          setFsrsFinished(next === null);
          if (next) void saveModePosition('fsrs', next.id);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Once settings and words are both available, restore the current mode.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (settings && words && !restoredRef.current) {
      restoredRef.current = true;
      restoreForMode(settings, words);
    }
  }, [settings, words, restoreForMode]);

  // ------------------------------------------------------------------ actions

  const pickNextRandom = async (
    s: AppSettingsState,
    allWords: WordRecord[],
    lastId: string | null,
  ) => {
    const result = pickRandom(allWords, s, lastId);
    if (!result) return;
    let round = s.randomRound;
    if (result.startedNewRound) {
      round += 1;
      const next = { ...s, randomRound: round };
      setSettings(next);
      await saveSettings({ randomRound: round });
    }
    await markRandomSeen(result.word.id, round);
    setCurrentWord(result.word);
    setFlipped(false);
    await saveModePosition('random', result.word.id);
  };

  const handleRandomNext = () => {
    if (!settings || !words) return;
    if (previewWordId) onClearPreview();
    void pickNextRandom(settings, words, currentWord?.id ?? null);
  };

  const handleTimeStep = (step: 1 | -1) => {
    if (!settings || !words) return;
    if (previewWordId) onClearPreview();
    const neighbor = timeNeighbor(
      words,
      settings.timeDirection,
      currentWord?.id ?? null,
      step,
    );
    if (neighbor) {
      setCurrentWord(neighbor);
      setFlipped(false);
      void saveModePosition('time', neighbor.id);
    }
  };

  const rating = useRef(false);

  const handleRate = async (known: boolean) => {
    if (!settings || !words || !currentWord) return;
    if (previewWordId) onClearPreview();
    // In-flight guard: a double-tap must not rate the card twice
    // (review finding #5).
    if (rating.current) return;
    rating.current = true;
    try {
      await rateWord(currentWord, known);
      const queue = buildFsrsQueue(
        words.filter((w) => w.id !== currentWord.id),
      );
      const next = queue.due[0] ?? queue.newCards[0] ?? null;
      setCurrentWord(next);
      setFlipped(false);
      setFsrsFinished(next === null);
      if (next) void saveModePosition('fsrs', next.id);
      else void saveModePosition('fsrs', null);
    } finally {
      rating.current = false;
    }
  };

  const switchMode = async (next: BrowseMode) => {
    if (!settings) return;
    if (previewWordId) onClearPreview();
    const updated = { ...settings, lastMode: next };
    setSettings(updated);
    await saveSettings({ lastMode: next });
    if (words) restoreForMode(updated, words);
  };

  const changeDirection = async (
    direction: AppSettingsState['timeDirection'],
  ) => {
    if (!settings) return;
    const updated = { ...settings, timeDirection: direction };
    setSettings(updated);
    await saveSettings({ timeDirection: direction });
    // Keep the current word; the next step follows the new direction
    // around it (PRD §4.10).
  };

  const changeUnseenRatio = async (ratio: number) => {
    if (!settings) return;
    const updated = { ...settings, unseenRatio: ratio };
    setSettings(updated);
    await saveSettings({ unseenRatio: ratio });
  };

  // ------------------------------------------------------------------ swipe

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current || !settings) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (mode === 'fsrs') return; // FSRS requires explicit feedback (PRD §4.1)
    if (mode === 'time') {
      handleTimeStep(dx < 0 ? 1 : -1);
    } else {
      handleRandomNext();
    }
  };

  // ------------------------------------------------------------------ render

  if (!settings || words === undefined) {
    return <div className="loading">…</div>;
  }

  if (!currentWord && words.length === 0) {
    return (
      <div className="home">
        <EmptyState />
        <button
          type="button"
          className="primary-btn"
          onClick={() => onNavigate('add')}
        >
          添加第一个单词
        </button>
      </div>
    );
  }

  return (
    <div
      className="home"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="mode-switcher" role="tablist">
        {(Object.keys(MODE_LABELS) as BrowseMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`mode-tab ${mode === m ? 'active' : ''}`}
            onClick={() => void switchMode(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === 'random' && (
        <div className="mode-controls">
          <label className="ratio-label">
            未浏览词 {Math.round(settings.unseenRatio * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.unseenRatio * 100)}
              onChange={(e) =>
                void changeUnseenRatio(Number(e.target.value) / 100)
              }
            />
            已浏览 {Math.round((1 - settings.unseenRatio) * 100)}%
          </label>
          <button
            type="button"
            className="ghost-btn"
            onClick={handleRandomNext}
          >
            下一张
          </button>
        </div>
      )}

      {mode === 'time' && (
        <div className="mode-controls">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void changeDirection('oldToNew')}
          >
            {settings.timeDirection === 'oldToNew' ? '● 旧→新' : '旧→新'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void changeDirection('newToOld')}
          >
            {settings.timeDirection === 'newToOld' ? '● 新→旧' : '新→旧'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => handleTimeStep(-1)}
          >
            上一张
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => handleTimeStep(1)}
          >
            下一张
          </button>
        </div>
      )}

      {fsrsFinished && mode === 'fsrs' && !previewWord ? (
        <div className="fsrs-done">
          <p>目前没有需要复习的单词 🎉</p>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void switchMode('random')}
          >
            去随机翻翻
          </button>
        </div>
      ) : displayWord ? (
        <div className="card-area">
          <WordCard
            word={displayWord}
            flipped={flipped}
            onFlip={() => setFlipped((v) => !v)}
          />
          {previewWord && (
            <div className="preview-banner">
              正在查看词条
              <button
                type="button"
                className="link-btn"
                onClick={onClearPreview}
              >
                返回当前模式
              </button>
            </div>
          )}
          <div className="card-toolbar">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setEditing(true)}
            >
              编辑
            </button>
          </div>
          {editing && displayWord && (
            <EditWordSheet
              word={displayWord}
              onClose={() => setEditing(false)}
              onDeleted={async () => {
                setEditing(false);
                if (previewWord) onClearPreview();
                // Re-read words: the live-query snapshot in this closure
                // still contains the deleted card (review finding #4).
                restoreForMode(
                  await loadSettings(),
                  await db.words.toArray(),
                );
              }}
            />
          )}
        </div>
      ) : null}

      {mode === 'fsrs' && currentWord && !previewWord && (
        <div className="fsrs-actions">
          {flipped ? (
            <>
              <button
                type="button"
                className="rate-btn rate-known"
                onClick={() => void handleRate(true)}
              >
                认识
              </button>
              <button
                type="button"
                className="rate-btn rate-unknown"
                onClick={() => void handleRate(false)}
              >
                不认识
              </button>
            </>
          ) : (
            <div className="fsrs-hint">先回忆，轻点卡片翻面后作答</div>
          )}
        </div>
      )}
    </div>
  );
}

function isEligible(word: WordRecord): boolean {
  if (!word.fsrsCard) return true;
  return word.fsrsCard.due.getTime() <= Date.now();
}
