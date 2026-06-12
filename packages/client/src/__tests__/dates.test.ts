import { describe, it, expect } from 'vitest';
import {
  todayKey,
  toKey,
  addDays,
  isOverdue,
  formatDeadlineShort,
  formatGroupHeader,
} from '../dates';

describe('todayKey', () => {
  it('has YYYY-MM-DD shape', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('toKey', () => {
  it('formats a Date into YYYY-MM-DD using local fields', () => {
    expect(toKey(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(toKey(new Date(2026, 11, 1))).toBe('2026-12-01');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('goes backwards across a month boundary', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('isOverdue', () => {
  it('returns true for yesterday', () => {
    expect(isOverdue(addDays(todayKey(), -1))).toBe(true);
  });

  it('returns FALSE for today', () => {
    expect(isOverdue(todayKey())).toBe(false);
  });

  it('returns false for tomorrow', () => {
    expect(isOverdue(addDays(todayKey(), 1))).toBe(false);
  });
});

describe('formatDeadlineShort', () => {
  it('labels today/tomorrow/yesterday relatively', () => {
    const today = todayKey();
    expect(formatDeadlineShort(today)).toBe('сегодня');
    expect(formatDeadlineShort(addDays(today, 1))).toBe('завтра');
    expect(formatDeadlineShort(addDays(today, -1))).toBe('вчера');
  });

  it('renders a far date with a Russian month name', () => {
    // A fixed far-future date so the label is deterministic.
    const label = formatDeadlineShort('2026-08-15');
    expect(label).toContain('августа');
    expect(label).toContain('15');
  });
});

describe('formatGroupHeader', () => {
  it('labels tomorrow as «Завтра» (capitalized)', () => {
    expect(formatGroupHeader(addDays(todayKey(), 1))).toBe('Завтра');
  });

  it('renders a far date with a Russian month name', () => {
    // ru-RU 'day numeric, month long' leads with the day number ("15 августа"),
    // so the day digit is first; the month name must still be present.
    const header = formatGroupHeader('2026-08-15');
    expect(header).toContain('августа');
    expect(header).toContain('15');
  });

  it('appends a weekday segment for a near-future header (1 < diff <= 7)', () => {
    // 3 days out falls in the window that appends ", <weekday>".
    const header = formatGroupHeader(addDays(todayKey(), 3));
    const parts = header.split(', ');
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBeTruthy();
  });

  it('capitalizes the first letter of letter-leading labels', () => {
    // The relative labels are the case where the header begins with a letter,
    // and that leading letter must be upper-case.
    const labels = [
      formatGroupHeader(todayKey()),
      formatGroupHeader(addDays(todayKey(), 1)),
      formatGroupHeader(addDays(todayKey(), -1)),
    ];
    expect(labels).toEqual(['Сегодня', 'Завтра', 'Вчера']);
    for (const label of labels) {
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
    }
  });
});
