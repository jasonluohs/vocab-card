import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import ManualAddForm, {
  describeError,
  type FlowResult,
} from '../components/add/ManualAddForm';
import PasteCollect from '../components/add/PasteCollect';
import PhotoCollect from '../components/add/PhotoCollect';
import { retryGeneration } from '../services/addService';

type AddTab = 'manual' | 'paste' | 'photo';

const TABS: { key: AddTab; label: string }[] = [
  { key: 'manual', label: '手动输入' },
  { key: 'paste', label: '粘贴文本' },
  { key: 'photo', label: '拍照识别' },
];

interface AddViewProps {
  onNavigate: (view: 'home' | 'add' | 'search' | 'settings') => void;
  onOpenWord: (wordId: string) => void;
}

export default function AddView({ onNavigate, onOpenWord }: AddViewProps) {
  const [tab, setTab] = useState<AddTab>('manual');
  const [result, setResult] = useState<FlowResult | null>(null);

  // Recent drafts (pending/failed) so the user can retry from this page.
  const recent = useLiveQuery(
    () =>
      db.words
        .where('generationStatus')
        .anyOf('pending', 'failed')
        .reverse()
        .sortBy('updatedAt'),
    [],
  );

  const retryRecent = async (wordId: string) => {
    const r = await retryGeneration(wordId);
    if (r && r.status !== 'invalid') {
      setResult({
        word: r.word,
        status: r.status === 'complete' ? 'added' : 'failed',
        error: r.status === 'failed' ? describeError(r.error) : undefined,
      });
    }
  };

  return (
    <div className="add-view">
      <h2>添加单词</h2>

      <div className="mode-switcher">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`mode-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => {
              setTab(t.key);
              setResult(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'manual' && (
        <>
          <ManualAddForm onResult={setResult} />
          {result && (
            <div className="add-result">
              <div className="add-result-term">{result.word.term}</div>
              <div className="add-result-note">
                {result.status === 'duplicate' && (
                  <>
                    已经收藏过了
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        onOpenWord(result.word.id);
                        onNavigate('home');
                      }}
                    >
                      打开卡片
                    </button>
                  </>
                )}
                {result.status === 'added' && (
                  <>
                    已保存
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        onOpenWord(result.word.id);
                        onNavigate('home');
                      }}
                    >
                      查看
                    </button>
                  </>
                )}
                {result.status === 'failed' && (
                  <>
                    <span className="add-result-warn">{result.error}</span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => void retryRecent(result.word.id)}
                    >
                      重试生成
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'paste' && <PasteCollect onOpenWord={onOpenWord} />}

      {tab === 'photo' && <PhotoCollect onOpenWord={onOpenWord} />}

      {recent && recent.length > 0 && tab === 'manual' && (
        <div className="add-recent">
          <h3>未完成的生成</h3>
          {recent.map((w) => (
            <div key={w.id} className="add-result">
              <div className="add-result-term">{w.term}</div>
              <div className="add-result-note">
                {w.generationStatus === 'failed' ? '生成失败' : '生成中…'}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void retryRecent(w.id)}
                >
                  重试生成
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    onOpenWord(w.id);
                    onNavigate('home');
                  }}
                >
                  查看
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
