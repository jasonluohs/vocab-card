export type NavTab = 'home' | 'add' | 'search' | 'settings';

interface BottomNavProps {
  activeTab: NavTab;
  onSelect: (tab: NavTab) => void;
}

const TABS: { key: NavTab; label: string }[] = [
  { key: 'home', label: '卡片' },
  { key: 'add', label: '添加' },
  { key: 'search', label: '搜索' },
  { key: 'settings', label: '设置' },
];

/** Compact bottom navigation; all targets exceed 44x44 CSS px (PRD §3.2). */
export default function BottomNav({ activeTab, onSelect }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`bottom-nav-item ${
            activeTab === tab.key ? 'active' : ''
          }`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
