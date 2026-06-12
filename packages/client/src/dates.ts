// All date math uses the local timezone, keyed by 'YYYY-MM-DD' strings.

export function todayKey(): string {
  return toKey(new Date());
}

export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a 'YYYY-MM-DD' key into a local Date (midnight local).
function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});

const dayMonthYearFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });

// '5 июня' — short relative-aware human label for a deadline key.
export function formatDeadlineShort(key: string): string {
  const today = todayKey();
  if (key === today) return 'сегодня';
  if (key === addDays(today, 1)) return 'завтра';
  if (key === addDays(today, -1)) return 'вчера';
  const d = fromKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? dayMonthFmt.format(d) : dayMonthYearFmt.format(d);
}

// Full group header for Upcoming / Logbook sections.
export function formatGroupHeader(key: string): string {
  const today = todayKey();
  if (key === today) return 'Сегодня';
  if (key === addDays(today, 1)) return 'Завтра';
  if (key === addDays(today, -1)) return 'Вчера';
  const d = fromKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const base = sameYear ? dayMonthFmt.format(d) : dayMonthYearFmt.format(d);
  // Capitalize and, for near future, append weekday for orientation.
  const today0 = fromKey(today).getTime();
  const diffDays = Math.round((d.getTime() - today0) / 86400000);
  if (diffDays > 1 && diffDays <= 7) {
    const wd = weekdayFmt.format(d);
    return `${capitalize(base)}, ${wd}`;
  }
  return capitalize(base);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isOverdue(key: string): boolean {
  return key < todayKey();
}
