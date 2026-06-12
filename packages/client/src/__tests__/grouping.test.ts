import { describe, it, expect } from 'vitest';
import { computeGroups } from '../grouping';
import { todayKey, addDays } from '../dates';
import type { Task } from '../types';

const today = todayKey();
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);
const plus30 = addDays(today, 30);

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

const NONE = new Set<number>();

function allTaskIds(groups: { tasks: Task[] }[]): number[] {
  return groups.flatMap((g) => g.tasks.map((t) => t.id));
}

describe('computeGroups — today', () => {
  it('includes overdue and today-due open tasks only', () => {
    const tasks = [
      makeTask({ id: 1, deadline: yesterday }), // overdue
      makeTask({ id: 2, deadline: today }), // due today
      makeTask({ id: 3, deadline: tomorrow }), // future
      makeTask({ id: 4, deadline: null }), // no deadline
      makeTask({ id: 5, deadline: today, status: 'done', completedAt: today }), // done
    ];
    const groups = computeGroups('today', tasks, NONE);
    expect(allTaskIds(groups).sort()).toEqual([1, 2]);
  });

  it('keeps a task whose id is in the leaving set even if no longer open', () => {
    const tasks = [
      makeTask({ id: 1, deadline: today, status: 'done', completedAt: today }),
    ];
    const leaving = new Set<number>([1]);
    const groups = computeGroups('today', tasks, leaving);
    expect(allTaskIds(groups)).toEqual([1]);
  });
});

describe('computeGroups — upcoming', () => {
  it('groups strictly-future open tasks by date ascending, excluding today/overdue/no-deadline', () => {
    const tasks = [
      makeTask({ id: 1, deadline: yesterday }),
      makeTask({ id: 2, deadline: today }),
      makeTask({ id: 3, deadline: tomorrow }),
      makeTask({ id: 4, deadline: plus30 }),
      makeTask({ id: 5, deadline: null }),
    ];
    const groups = computeGroups('upcoming', tasks, NONE);
    // only tomorrow + plus30, ascending
    expect(groups.map((g) => g.key)).toEqual([tomorrow, plus30]);
    expect(allTaskIds(groups)).toEqual([3, 4]);
  });
});

describe('computeGroups — all', () => {
  it('includes every open task, including ones with no deadline', () => {
    const tasks = [
      makeTask({ id: 1, deadline: yesterday }),
      makeTask({ id: 2, deadline: today }),
      makeTask({ id: 3, deadline: tomorrow }),
      makeTask({ id: 4, deadline: null }),
      makeTask({ id: 5, status: 'done', completedAt: today }),
    ];
    const groups = computeGroups('all', tasks, NONE);
    expect(allTaskIds(groups).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('computeGroups — logbook', () => {
  it('only includes done tasks, grouped by completion day, newest first', () => {
    const dayA = '2026-06-10';
    const dayB = '2026-06-11';
    const tasks = [
      makeTask({ id: 1, status: 'open', deadline: today }),
      makeTask({
        id: 2,
        status: 'done',
        completedAt: `${dayA}T09:00:00.000Z`,
      }),
      makeTask({
        id: 3,
        status: 'done',
        completedAt: `${dayB}T09:00:00.000Z`,
      }),
    ];
    const groups = computeGroups('logbook', tasks, NONE);
    expect(groups.map((g) => g.key)).toEqual([dayB, dayA]); // newest day first
    expect(allTaskIds(groups)).toEqual([3, 2]);
  });

  it('falls back to updatedAt day when completedAt is null', () => {
    const tasks = [
      makeTask({
        id: 1,
        status: 'done',
        completedAt: null,
        updatedAt: '2026-05-20T12:00:00.000Z',
      }),
    ];
    const groups = computeGroups('logbook', tasks, NONE);
    expect(groups.map((g) => g.key)).toEqual(['2026-05-20']);
    expect(allTaskIds(groups)).toEqual([1]);
  });
});
