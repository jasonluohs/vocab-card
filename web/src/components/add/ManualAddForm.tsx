import { useState } from 'react';
import type { WordRecord } from '../../db/db';
import { addWord } from '../../services/addService';
import { ApiError } from '../../services/generationClient';

export function describeError(err: ApiError): string {
  if (err.needsAccessCode) return '需要输入访问码（在设置中填写）';
  const map: Record<string, string> = {
    invalid_access_code: '访问码不对，请检查后重试',
    rate_limited: '请求太频繁，稍等一分钟再试',
    network_error: '网络不可用，可稍后重试',
    proxy_not_configured: '尚未配置生成服务地址',
    invalid_model_output: '生成结果无效',
  };
  return map[err.message] ?? `生成失败（${err.message}）`;
}

export interface FlowResult {
  word: WordRecord;
  status: 'added' | 'duplicate' | 'failed';
  error?: string;
}

interface ManualAddFormProps {
  onResult: (result: FlowResult | null) => void;
}

export default function ManualAddForm({ onResult }: ManualAddFormProps) {
  const [term, setTerm] = useState('');
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  const submit = async () => {
    const t = term.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    setFlowError(null);
    try {
      const result = await addWord(t, context.trim() || undefined);
      if (result.status === 'duplicate') {
        onResult({ word: result.word, status: 'duplicate' });
      } else if (result.status !== 'invalid') {
        onResult({
          word: result.word,
          status: result.status === 'complete' ? 'added' : 'failed',
          error:
            result.status === 'failed' ? describeError(result.error) : undefined,
        });
        setTerm('');
        setContext('');
      }
    } catch {
      // Unexpected failure (e.g. storage full) — never a silent rejection.
      setFlowError('保存失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="add-form">
      <input
        className="text-input"
        type="text"
        placeholder="英文单词或短语"
        value={term}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <textarea
        className="text-input"
        placeholder="遇到它的原句（可选，释义会贴合语境）"
        rows={3}
        value={context}
        onChange={(e) => setContext(e.target.value)}
      />
      <button
        type="button"
        className="primary-btn"
        disabled={!term.trim() || submitting}
        onClick={() => void submit()}
      >
        {submitting ? '生成中…' : '保存并生成释义'}
      </button>
      {flowError && <div className="add-result-warn">{flowError}</div>}
    </div>
  );
}
