import { useMemo, useState } from 'react';
import TokenizedTextView from './TokenizedTextView';
import {
  sentenceAt,
  tokenizeText,
  type TextPart,
} from '../../lib/textTokens';
import {
  batchCollect,
  buildBatchGroups,
  MAX_BATCH_TERMS,
  retryBatchItem,
  type BatchOutcome,
} from '../../services/batchService';
import { normalizeTerm } from '../../db/normalize';

interface PasteCollectProps {
  onOpenWord: (wordId: string) => void;
}

/**
 * Paste-text batch collect (PRD §4.3):
 * paste → clickable text → select tokens → per-word generate/save.
 */
export default function PasteCollect({ onOpenWord }: PasteCollectProps) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<BatchOutcome[]>([]);

  const parts = useMemo<TextPart[]>(
    () => (parsed ? tokenizeText(text) : []),
    [parsed, text],
  );

  const distinctTerms = useMemo(() => {
    const terms = new Set<string>();
    for (const index of selected) {
      const part = parts[index];
      if (part?.kind === 'token') terms.add(normalizeTerm(part.text));
    }
    return terms;
  }, [selected, parts]);

  const overLimit = distinctTerms.size > MAX_BATCH_TERMS;

  const parse = () => {
    if (!text.trim()) return;
    setParsed(true);
    setSelected(new Set());
    setOutcomes([]);
  };

  const backToEdit = () => {
    setParsed(false);
    setSelected(new Set());
    setOutcomes([]);
  };

  const toggleToken = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0 || overLimit || running) return;
    setRunning(true);
    setOutcomes([]);
    const entries = Array.from(selected, (index) => ({
      term: parts[index].text,
      offset: parts[index].start,
    }));
    try {
      const groups = await buildBatchGroups(text, entries, sentenceAt);
      await batchCollect(groups, (outcome) => {
        setOutcomes((prev) => [...prev, outcome]);
      });
    } finally {
      setRunning(false);
    }
  };

  const retryOne = async (wordId: string) => {
    const outcome = await retryBatchItem(wordId);
    if (outcome) {
      setOutcomes((prev) =>
        prev.map((o) => (o.wordId === wordId ? outcome : o)),
      );
    }
  };

  if (!parsed) {
    return (
      <div className="add-form">
        <textarea
          className="text-input paste-textarea"
          placeholder="粘贴一段英文原文：论文、书页、网页文字…"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="primary-btn"
          disabled={!text.trim()}
          onClick={parse}
        >
          解析并选词
        </button>
      </div>
    );
  }

  return (
    <div className="paste-collect">
      <TokenizedTextView
        parts={parts}
        selected={selected}
        onToggle={toggleToken}
      />

      {overLimit && (
        <div className="add-result-warn">
          一次最多选择 {MAX_BATCH_TERMS} 个不同的词，请先取消部分选择。
        </div>
      )}

      <div className="mode-controls">
        <span className="muted">
          已选 {distinctTerms.size} 个词（上限 {MAX_BATCH_TERMS}）
        </span>
        <button
          type="button"
          className="ghost-btn"
          onClick={backToEdit}
          disabled={running}
        >
          编辑原文
        </button>
        <button
          type="button"
          className="primary-btn paste-submit"
          disabled={selected.size === 0 || overLimit || running}
          onClick={() => void submit()}
        >
          {running ? '生成中…' : '收藏选中的词'}
        </button>
      </div>

      {outcomes.length > 0 && (
        <div className="add-recent">
          <h3>
            结果（{outcomes.filter((o) => o.kind !== 'failed').length}/
            {outcomes.length} 成功）
          </h3>
          {outcomes.map((o) => (
            <div key={o.term} className="add-result">
              <div className="add-result-term">{o.term}</div>
              <div className="add-result-note">
                {o.kind === 'created' && (
                  <>
                    已生成新词卡
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => o.wordId && onOpenWord(o.wordId)}
                    >
                      查看
                    </button>
                  </>
                )}
                {o.kind === 'context' && <>已收藏过，追加了原句语境</>}
                {o.kind === 'failed' && (
                  <>
                    <span className="add-result-warn">生成失败：{o.error}</span>
                    {o.wordId && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void retryOne(o.wordId!)}
                      >
                        重试
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
