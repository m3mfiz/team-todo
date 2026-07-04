import type { ComponentType } from 'react';
import type { TabKey } from './types';
import { CalendarIcon, CheckCircleIcon, type IconProps, LayersIcon, StarIcon } from './icons';

// Shared tab -> icon + accent color table, consumed by TabBar (size 25) and
// TaskList's empty states (size 48) so both stay in sync.
export const TAB_ICON: Record<TabKey, { icon: ComponentType<IconProps>; colorVar: string }> = {
  today: { icon: StarIcon, colorVar: 'var(--star)' },
  upcoming: { icon: CalendarIcon, colorVar: 'var(--cal)' },
  all: { icon: LayersIcon, colorVar: 'var(--layers)' },
  logbook: { icon: CheckCircleIcon, colorVar: 'var(--check)' },
};
