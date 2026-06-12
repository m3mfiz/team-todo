import type { JSX } from 'react';
import type { TabKey } from '../types';
import { CalendarIcon, CheckCircleIcon, LayersIcon, StarIcon } from '../icons';

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  counts: Record<TabKey, number>;
}

interface TabDef {
  key: TabKey;
  label: string;
  icon: JSX.Element;
  colorVar: string;
}

const TABS: TabDef[] = [
  { key: 'today', label: 'Сегодня', icon: <StarIcon size={25} />, colorVar: 'var(--star)' },
  { key: 'upcoming', label: 'Предстоящие', icon: <CalendarIcon size={25} />, colorVar: 'var(--cal)' },
  { key: 'all', label: 'Все задачи', icon: <LayersIcon size={25} />, colorVar: 'var(--layers)' },
  { key: 'logbook', label: 'Журнал', icon: <CheckCircleIcon size={25} />, colorVar: 'var(--check)' },
];

export function TabBar({ active, onChange, counts }: TabBarProps): JSX.Element {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const count = counts[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            className={`tab${isActive ? ' tab--active' : ''}`}
            style={isActive ? { color: tab.colorVar } : undefined}
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="tab__icon" style={{ color: tab.colorVar }}>
              {tab.icon}
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
