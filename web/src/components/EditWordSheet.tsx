import { useState } from 'react';
import type { AdditionalSense, WordRecord } from '../db/db';
import { deleteWord, editWord } from '../services/wordRepository';

interface EditWordSheetProps {
  word: WordRecord;
  onClose: () => void;
  onDeleted: () => void;
}

/** One sense per line: `中文 | English | 例句(可选)` */
function sensesToText(senses: AdditionalSense[]): string {
  return senses
    .map((s) => [s.chinese, s.english, s.example ?? ''].join(' | '))
    .join('\n');
}

function parseSenses(text: string): AdditionalSense[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [chinese = '', english = '', example] = line.split('|').map((p) => p.trim());
      return { chinese, english, ...(example ? { example } : {}) };
    })
    .filter((s) => s.chinese && s.english);
}

export default function EditWordSheet({
  word,
  onClose,
  onDeleted,
}: EditWordSheetProps) {
  const [term, setTerm] = useState(word.term);
  const [primaryChinese, setPrimaryChinese] = useState(word.primaryChinese);
  const [primaryEnglish, setPrimaryEnglish] = useState(word.primaryEnglish);
  const [exampleSentence, setExampleSentence] = useState(word.exampleSentence);
  const [sensesText, setSensesText] = useState(sensesToText(word.additionalSenses));
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const result = await editWord(word.id, {
      term,
      primaryChinese,
      primaryEnglish,
      exampleSentence,
      additionalSenses: parseSenses(sensesText),
    });
    setSaving(false);
    if (result.conflict) {
      setConflict(`已存在词条「${result.conflict.term}」，请换个写法或先处理重复`);
      return;
    }
    onClose();
  };

  const remove = async () => {
    if (!window.confirm(`删除「${word.term}」及其所有记录？此操作不可撤销。`)) {
      return;
    }
    await deleteWord(word.id);
    onDeleted();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>编辑词条</h3>
        <label className="field">
          <span>英文词/短语</span>
          <input
            className="text-input"
            type="text"
            value={term}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        {conflict && <div className="add-result-warn">{conflict}</div>}
        <label className="field">
          <span>中文主释义</span>
          <textarea
            className="text-input"
            rows={2}
            value={primaryChinese}
            onChange={(e) => setPrimaryChinese(e.target.value)}
          />
        </label>
        <label className="field">
          <span>英文释义</span>
          <textarea
            className="text-input"
            rows={2}
            value={primaryEnglish}
            onChange={(e) => setPrimaryEnglish(e.target.value)}
          />
        </label>
        <label className="field">
          <span>例句</span>
          <textarea
            className="text-input"
            rows={2}
            value={exampleSentence}
            onChange={(e) => setExampleSentence(e.target.value)}
          />
        </label>
        <label className="field">
          <span>其他释义（每行：中文 | English | 例句可选）</span>
          <textarea
            className="text-input"
            rows={3}
            value={sensesText}
            onChange={(e) => setSensesText(e.target.value)}
          />
        </label>
        <div className="sheet-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-btn sheet-save"
            disabled={saving || !term.trim()}
            onClick={() => void save()}
          >
            保存
          </button>
        </div>
        <button type="button" className="danger-btn" onClick={() => void remove()}>
          删除这个词条…
        </button>
      </div>
    </div>
  );
}

