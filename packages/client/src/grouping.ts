import type { Task, TabKey } from './types';
import { formatGroupHeader, todayKey } from './dates';

export interface Group {
  key: string;
  header: string | null;
  tasks: Task[];
}

// Map raw tasks into the current user's view-model.
//
// For a member, a shared task (assigneeId === null) is "done" as soon as HE
// has marked it (myCompleted) — even while the global status is still 'open'
// because teammates haven't finished. His logbook date is his own mark date
// (taken from completions), falling back to the global completedAt when the
// task was force-completed by the admin without his mark.
//
// Admins (and personal tasks for everyone) see raw global status untouched.
// completions/myCompleted are preserved as-is so the UI can render raw data.
export function toViewTasks(
  tasks: Task[],
  opts: { isAdmin: boolean; userId: number },
): Task[] {
  if (opts.isAdmin) return tasks;
  return tasks.map((t) => {
    if (t.assigneeId !== null) return t; // personal task — untouched
    const globallyDone = t.status === 'done';
    if (!t.myCompleted && !globallyDone) return t;
    const own = t.completions?.find((c) => c.userId === opts.userId);
    const ownDate = t.myCompleted ? (own?.completedAt ?? null) : null;
    return {
      ...t,
      status: 'done',
      completedAt: ownDate ?? t.completedAt,
    };
  });
}

export function computeGroups(
  tab: TabKey,
  tasks: Task[],
  leaving: Set<number>,
): Group[] {
  const today = todayKey();

  if (tab === 'today') {
    const items = tasks.filter(
      (t) =>
        (t.status === 'open' || leaving.has(t.id)) &&
        t.deadline !== null &&
        t.deadline <= today,
    );
    sortByDeadline(items);
    return items.length ? [{ key: 'today', header: null, tasks: items }] : [];
  }

  if (tab === 'upcoming') {
    const items = tasks.filter(
      (t) => t.status === 'open' && t.deadline !== null && t.deadline > today,
    );
    const byDate = new Map<string, Task[]>();
    for (const t of items) {
      const k = t.deadline as string;
      const arr = byDate.get(k);
      if (arr) arr.push(t);
      else byDate.set(k, [t]);
    }
    return [...byDate.keys()]
      .sort()
      .map((k) => ({
        key: k,
        header: formatGroupHeader(k),
        tasks: byDate.get(k) as Task[],
      }));
  }

  if (tab === 'all') {
    const items = tasks.filter((t) => t.status === 'open' || leaving.has(t.id));
    // Dated first (by date), then undated.
    const dated = items.filter((t) => t.deadline !== null);
    const undated = items.filter((t) => t.deadline === null);
    sortByDeadline(dated);
    undated.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const ordered = [...dated, ...undated];
    return ordered.length ? [{ key: 'all', header: null, tasks: ordered }] : [];
  }

  // logbook — done tasks, newest completed first, grouped by completion date
  const done = tasks.filter((t) => t.status === 'done' && !leaving.has(t.id));
  done.sort((a, b) => completedSort(b) - completedSort(a));
  const byDay = new Map<string, Task[]>();
  for (const t of done) {
    const day = (t.completedAt ?? t.updatedAt).slice(0, 10);
    const arr = byDay.get(day);
    if (arr) arr.push(t);
    else byDay.set(day, [t]);
  }
  return [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({
      key: day,
      header: formatGroupHeader(day),
      tasks: byDay.get(day) as Task[],
    }));
}

function sortByDeadline(items: Task[]): void {
  items.sort((a, b) => {
    const ad = a.deadline ?? '9999-99-99';
    const bd = b.deadline ?? '9999-99-99';
    if (ad !== bd) return ad.localeCompare(bd);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function completedSort(t: Task): number {
  const stamp = t.completedAt ?? t.updatedAt;
  const time = Date.parse(stamp);
  return Number.isNaN(time) ? 0 : time;
}
