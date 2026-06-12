import { describe, it, expect } from 'vitest';
import { computeGroups, toViewTasks } from '../grouping';
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

describe('toViewTasks', () => {
  const ME = 7;
  const OTHER = 8;

  function sharedTask(overrides: Partial<Task> & { id: number }): Task {
    return makeTask({ assigneeId: null, assigneeName: null, ...overrides });
  }

  it('member: myCompleted shared task becomes done with HIS completion date', () => {
    const myDate = '2026-06-10 09:30:00';
    const raw = sharedTask({
      id: 1,
      status: 'open',
      completedAt: null,
      myCompleted: true,
      completions: [
        { userId: ME, displayName: 'Я', completedAt: myDate },
        { userId: OTHER, displayName: 'Коллега', completedAt: '2026-06-11 10:00:00' },
      ],
    });
    const [view] = toViewTasks([raw], { isAdmin: false, userId: ME });
    expect(view.status).toBe('done');
    expect(view.completedAt).toBe(myDate);
    // raw completions/myCompleted preserved for the UI
    expect(view.myCompleted).toBe(true);
    expect(view.completions).toEqual(raw.completions);
    // and it lands in HIS logbook under his date
    const groups = computeGroups('logbook', [view], NONE);
    expect(groups.map((g) => g.key)).toEqual(['2026-06-10']);
  });

  it('member: shared task without his mark stays open and untouched', () => {
    const raw = sharedTask({
      id: 2,
      status: 'open',
      myCompleted: false,
      completions: [
        { userId: OTHER, displayName: 'Коллега', completedAt: '2026-06-11 10:00:00' },
      ],
    });
    const [view] = toViewTasks([raw], { isAdmin: false, userId: ME });
    expect(view).toBe(raw); // same object — no changes
    expect(view.status).toBe('open');
  });

  it('member: globally done shared task without his mark (admin force) uses global completedAt', () => {
    const raw = sharedTask({
      id: 3,
      status: 'done',
      completedAt: '2026-06-09 18:00:00',
      myCompleted: false,
      completions: [],
    });
    const [view] = toViewTasks([raw], { isAdmin: false, userId: ME });
    expect(view.status).toBe('done');
    expect(view.completedAt).toBe('2026-06-09 18:00:00');
  });

  it('admin: tasks are returned unchanged even with completion marks', () => {
    const raw = [
      sharedTask({
        id: 4,
        status: 'open',
        myCompleted: true,
        completions: [
          { userId: ME, displayName: 'Я', completedAt: '2026-06-10 09:30:00' },
        ],
      }),
      makeTask({ id: 5, assigneeId: ME, assigneeName: 'Я', status: 'open' }),
    ];
    const view = toViewTasks(raw, { isAdmin: true, userId: 1 });
    expect(view).toBe(raw);
    expect(view[0].status).toBe('open'); // open until everyone is done
  });

  it('member: personal tasks are untouched regardless of status', () => {
    const open = makeTask({ id: 6, assigneeId: ME, assigneeName: 'Я' });
    const done = makeTask({
      id: 7,
      assigneeId: ME,
      assigneeName: 'Я',
      status: 'done',
      completedAt: '2026-06-08 12:00:00',
    });
    const view = toViewTasks([open, done], { isAdmin: false, userId: ME });
    expect(view[0]).toBe(open);
    expect(view[1]).toBe(done);
  });

  it('does not mutate the input tasks', () => {
    const raw = sharedTask({
      id: 8,
      status: 'open',
      completedAt: null,
      myCompleted: true,
      completions: [
        { userId: ME, displayName: 'Я', completedAt: '2026-06-10 09:30:00' },
      ],
    });
    toViewTasks([raw], { isAdmin: false, userId: ME });
    expect(raw.status).toBe('open');
    expect(raw.completedAt).toBeNull();
  });
});
