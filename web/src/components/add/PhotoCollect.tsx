import { useMemo, useRef, useState } from 'react';
import TokenizedTextView from './TokenizedTextView';
import { sentenceAt, tokenizeText, type TextPart } from '../../lib/textTokens';
import {
  batchCollect,
  buildBatchGroups,
  MAX_BATCH_TERMS,
  retryBatchItem,
  type BatchOutcome,
} from '../../services/batchService';
import { normalizeTerm } from '../../db/normalize';
import { ocrImage } from '../../services/ocrClient';
import { ApiError } from '../../services/generationClient';

interface PhotoCollectProps {
  onOpenWord: (wordId: string) => void;
}

type Stage = 'select' | 'recognizing' | 'edit' | 'pick';

/**
 * Photo OCR batch collect (PRD §4.4):
 * camera/album image → OCR → editable text → token picking → batch save.
 */
export default function PhotoCollect({ onOpenWord }: PhotoCollectProps) {
  const [stage, setStage] = useState<Stage>('select');
  const [text, setText] = useState('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<BatchOutcome[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const parts = useMemo<TextPart[]>(
    () => (stage === 'pick' ? tokenizeText(text) : []),
    [stage, text],
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

  const pickFile = () => fileInput.current?.click();

  const onFileChosen = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setStage('recognizing');
    setOcrError(null);
    setOutcomes([]);
    setSelected(new Set());
    try {
      const recognized = await ocrImage(file);
      if (!recognized.trim()) {
        setOcrError('没有识别到文字，请重新拍摄或改用粘贴文本。');
        setStage('select');
        return;
      }
      setText(recognized);
      setStage('edit');
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.message === 'image_too_large') {
        setOcrError('图片太大，请重新拍摄或裁剪后再试。');
      } else if (apiError?.needsAccessCode) {
        setOcrError('需要输入访问码（在设置中填写）。');
      } else {
        setOcrError('识别失败，请重试。已修改的文字会保留。');
      }
      setStage('edit');
      if (!text) setStage('select');
    }
  };

  const retryOcr = () => {
    setOcrError(null);
    pickFile();
  };

  const parse = () => {
    if (!text.trim()) return;
    setStage('pick');
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
      await batchCollect(
        groups,
        (outcome) => setOutcomes((prev) => [...prev, outcome]),
        'ocr',
      );
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

  return (
    <div className="paste-collect">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onFileChosen(file);
        }}
      />

      {stage === 'select' && (
        <div className="add-form">
          <button
            type="button"
            className="primary-btn"
            onClick={pickFile}
          >
            拍照或从相册选择
          </button>
          <p className="muted">
            适合纸质书页。识别后可以修正文字，再选择要收藏的词。
          </p>
          {ocrError && <div className="add-result-warn">{ocrError}</div>}
        </div>
      )}

      {stage === 'recognizing' && (
        <div className="loading">识别中…</div>
      )}

      {stage === 'edit' && (
        <div className="add-form">
          {ocrError && (
            <div className="add-result-warn">
              {ocrError}
              <button
                type="button"
                className="link-btn"
                onClick={retryOcr}
              >
                重新拍摄
              </button>
            </div>
          )}
          <textarea
            className="text-input paste-textarea"
            placeholder="识别出的文字"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mode-controls">
            <button
              type="button"
              className="ghost-btn"
              onClick={retryOcr}
            >
              重新拍摄
            </button>
            <button
              type="button"
              className="primary-btn paste-submit"
              disabled={!text.trim()}
              onClick={parse}
            >
              解析并选词
            </button>
          </div>
        </div>
      )}

      {stage === 'pick' && (
        <>
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
              onClick={() => setStage('edit')}
              disabled={running}
            >
              修改识别文字
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
        </>
      )}

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
                {o.kind === 'context' && <>已收藏过，追加了拍照语境</>}
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
