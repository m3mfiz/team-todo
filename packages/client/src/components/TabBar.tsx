import type { JSX } from 'react';
import type { TabKey } from '../types';
import { TAB_ICON } from '../tabs';

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  counts: Record<TabKey, number>;
}

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'upcoming', label: 'Предстоящие' },
  { key: 'all', label: 'Все задачи' },
  { key: 'logbook', label: 'Журнал' },
];

export function TabBar({ active, onChange, counts }: TabBarProps): JSX.Element {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const count = counts[tab.key];
        const { icon: Icon, colorVar } = TAB_ICON[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            className={`tab${isActive ? ' tab--active' : ''}`}
            style={isActive ? { color: colorVar } : undefined}
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="tab__icon" style={{ color: colorVar }}>
              <Icon size={25} />
              {count > 0 && tab.key !== 'logbook' && (
                <span className="tab__badge">{count}</span>
              )}
            </span>
            <span className="tab__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
