import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { buildSearchDocs, searchDocs } from '../services/searchService';

interface SearchViewProps {
  onNavigate: (view: 'home' | 'add' | 'search' | 'settings') => void;
  onOpenWord: (wordId: string) => void;
}

/** Local search over saved cards; works offline (PRD §4.7). */
export default function SearchView({ onNavigate, onOpenWord }: SearchViewProps) {
  const [rawQuery, setRawQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [noResult, setNoResult] = useState(false);

  const words = useLiveQuery(() => db.words.toArray(), []);
  const contexts = useLiveQuery(() => db.contexts.toArray(), []);

  // Debounce ~180ms (PRD §4.7).
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(rawQuery), 180);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Empty query: nothing has been searched yet, show nothing.
  useEffect(() => {
    if (!debounced.trim()) {
      setNoResult(false);
    }
  }, [debounced]);

  const docs = useMemo(
    () => (words && contexts ? buildSearchDocs(words, contexts) : []),
    [words, contexts],
  );

  const results = useMemo(
    () => (debounced.trim() ? searchDocs(docs, debounced) : []),
    [docs, debounced],
  );

  useEffect(() => {
    setNoResult(Boolean(debounced.trim()) && results.length === 0);
  }, [debounced, results]);

  return (
    <div className="search-view">
      <h2>搜索</h2>
      <input
        className="text-input"
        type="search"
        placeholder="英文单词 / 中文释义 / 例句 / 原句片段"
        value={rawQuery}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => setRawQuery(e.target.value)}
      />

      {results.length > 0 && (
        <div className="search-results">
          {results.map((hit) => (
            <button
              key={hit.wordId}
              type="button"
              className="search-result"
              onClick={() => {
                onOpenWord(hit.wordId);
                onNavigate('home');
              }}
            >
              <span className="search-result-term">{hit.term}</span>
              <span className="muted">{hit.primaryChinese}</span>
            </button>
          ))}
        </div>
      )}

      {noResult && (
        <div className="empty-state">
          <p>没有找到已收藏的单词</p>
        </div>
      )}
    </div>
  );
}
