import { useEffect, useState } from 'react';
import HomeView from './views/HomeView';
import AddView from './views/AddView';
import SearchView from './views/SearchView';
import SettingsView from './views/SettingsView';
import BottomNav, { type NavTab } from './components/BottomNav';

export type ViewName = 'home' | 'add' | 'search' | 'settings';

const TAB_TO_VIEW: Record<NavTab, ViewName> = {
  home: 'home',
  add: 'add',
  search: 'search',
  settings: 'settings',
};
const VIEW_TO_TAB: Record<ViewName, NavTab> = {
  home: 'home',
  add: 'add',
  search: 'search',
  settings: 'settings',
};

function viewFromHash(): ViewName {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'add' || h === 'search' || h === 'settings') return h;
  return 'home';
}

/**
 * Single-page app with hash routing, so GitHub Pages direct refreshes
 * never 404 (PRD §7.3).
 */
export default function App() {
  const [view, setView] = useState<ViewName>(() => viewFromHash());
  const [previewWordId, setPreviewWordId] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: ViewName) => {
    if (next !== 'home') setPreviewWordId(null);
    window.location.hash = next === 'home' ? '#/' : `#/${next}`;
  };

  const openWord = (wordId: string) => setPreviewWordId(wordId);

  return (
    <div className="app">
      <main className="app-main">
        {view === 'home' && (
          <HomeView
            onNavigate={navigate}
            previewWordId={previewWordId}
            onClearPreview={() => setPreviewWordId(null)}
          />
        )}
        {view === 'add' && <AddView onNavigate={navigate} onOpenWord={openWord} />}
        {view === 'search' && (
          <SearchView onNavigate={navigate} onOpenWord={openWord} />
        )}
        {view === 'settings' && <SettingsView onNavigate={navigate} />}
      </main>
      <BottomNav
        activeTab={VIEW_TO_TAB[view]}
        onSelect={(tab) => navigate(TAB_TO_VIEW[tab])}
      />
    </div>
  );
}
