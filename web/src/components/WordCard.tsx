import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { ContextRecord, WordRecord } from '../db/db';
import { retryGeneration } from '../services/addService';

interface WordCardProps {
  word: WordRecord;
  flipped: boolean;
  onFlip: () => void;
}

/**
 * The main word card. Front shows only the term; the back shows
 * definitions, example, collapsible senses and original contexts
 * (PRD §3.2).
 */
export default function WordCard({ word, flipped, onFlip }: WordCardProps) {
  const contexts = useLiveQuery(
    () => db.contexts.where('wordId').equals(word.id).toArray(),
    [word.id],
    [] as ContextRecord[],
  );
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    await retryGeneration(word.id);
    setRetrying(false);
  };

  return (
    <div
      className={`card ${flipped ? 'card-flipped' : ''}`}
      onClick={onFlip}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onFlip();
      }}
    >
      <div className="card-inner">
        <div className="card-face card-front">
          <div className="card-term">{word.term}</div>
          {word.generationStatus === 'pending' && (
            <div className="card-hint">生成中…</div>
          )}
          {word.generationStatus === 'failed' && (
            <div className="card-hint card-hint-warn">
              生成失败
              <button
                type="button"
                className="link-btn"
                disabled={retrying}
                onClick={(e) => {
                  e.stopPropagation();
                  void retry();
                }}
              >
                {retrying ? '重试中…' : '重试生成'}
              </button>
            </div>
          )}
          <div className="card-hint-sub">轻点查看释义</div>
        </div>
        <div className="card-face card-back">
          <div className="card-back-term">{word.term}</div>
          {word.generationStatus === 'complete' ? (
            <CardBackContent word={word} contexts={contexts} />
          ) : (
            <div className="card-hint">释义尚未生成</div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardBackContent({
  word,
  contexts,
}: {
  word: WordRecord;
  contexts: ContextRecord[];
}) {
  const [showSenses, setShowSenses] = useState(false);
  const [showContexts, setShowContexts] = useState(false);

  // Reset the collapsed sections when the word changes.
  useEffect(() => {
    setShowSenses(false);
    setShowContexts(false);
  }, [word.id]);

  return (
    <div className="card-back-content">
      <p className="card-def-zh">{word.primaryChinese}</p>
      <p className="card-def-en">{word.primaryEnglish}</p>
      <p className="card-example">{word.exampleSentence}</p>

      {word.additionalSenses.length > 0 && (
        <button
          type="button"
          className="card-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setShowSenses((v) => !v);
          }}
        >
          {showSenses ? '收起其他释义' : `其他释义（${word.additionalSenses.length}）`}
        </button>
      )}
      {showSenses && (
        <div className="card-section">
          {word.additionalSenses.map((sense, i) => (
            <div key={i} className="card-sense">
              <div>{sense.chinese}</div>
              <div className="muted">{sense.english}</div>
            </div>
          ))}
        </div>
      )}

      {contexts.length > 0 && (
        <button
          type="button"
          className="card-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setShowContexts((v) => !v);
          }}
        >
          {showContexts ? '收起原句' : `我遇到它的原句（${contexts.length}）`}
        </button>
      )}
      {showContexts && (
        <div className="card-section">
          {contexts.map((ctx) => (
            <div key={ctx.id} className="card-context">
              <div className="card-context-sentence">{ctx.sentence}</div>
              <div className="muted card-context-meta">
                {ctx.sourceType === 'ocr' ? '拍照' : '粘贴'} ·{' '}
                {new Date(ctx.capturedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
