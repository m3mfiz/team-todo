import { describe, it, expect } from 'vitest';
import { filterTasks, groupSearchResults } from '../search';
import type { Task } from '../types';

function makeTask(overrides: Partial<Task> & { id: number }): Task {
  return {
    title: `task-${overrides.id}`,
    notes: null,
    deadline: null,
    status: 'open',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    creatorId: 1,
    creatorName: 'creator',
    assigneeId: null,
    assigneeName: null,
    ...overrides,
  };
}

describe('filterTasks', () => {
  it('matches by title, case-insensitively', () => {
    const tasks = [makeTask({ id: 1, title: 'Купить Молоко' })];
    expect(filterTasks(tasks, 'молок')).toEqual(tasks);
    expect(filterTasks(tasks, 'МОЛОКО')).toEqual(tasks);
  });

  it('matches by notes, case-insensitively', () => {
    const tasks = [makeTask({ id: 1, title: 'Задача', notes: 'Позвонить Клиенту' })];
    expect(filterTasks(tasks, 'клиенту')).toEqual(tasks);
  });

  it('returns no matches when the query is not found in title or notes', () => {
    const tasks = [makeTask({ id: 1, title: 'Купить молоко', notes: 'заметка' })];
    expect(filterTasks(tasks, 'хлеб')).toEqual([]);
  });

  it('returns an empty array for a blank query', () => {
    const tasks = [makeTask({ id: 1, title: 'Купить молоко' })];
    expect(filterTasks(tasks, '')).toEqual([]);
    expect(filterTasks(tasks, '   ')).toEqual([]);
  });

  it('tolerates tasks with no notes', () => {
    const tasks = [makeTask({ id: 1, title: 'Купить молоко', notes: null })];
    expect(filterTasks(tasks, 'молоко')).toEqual(tasks);
  });
});

describe('groupSearchResults', () => {
  it('splits matches into «Открытые» and «Журнал» groups', () => {
    const open = makeTask({ id: 1, status: 'open' });
    const done = makeTask({ id: 2, status: 'done' });
    const groups = groupSearchResults([open, done]);
    expect(groups).toEqual([
      { key: 'search-open', header: 'Открытые', tasks: [open] },
      { key: 'search-done', header: 'Журнал', tasks: [done] },
    ]);
  });

  it('omits an empty group', () => {
    const open = makeTask({ id: 1, status: 'open' });
    expect(groupSearchResults([open])).toEqual([
      { key: 'search-open', header: 'Открытые', tasks: [open] },
    ]);

    const done = makeTask({ id: 2, status: 'done' });
    expect(groupSearchResults([done])).toEqual([
      { key: 'search-done', header: 'Журнал', tasks: [done] },
    ]);
  });

  it('returns an empty array when there are no matches', () => {
    expect(groupSearchResults([])).toEqual([]);
  });
});
