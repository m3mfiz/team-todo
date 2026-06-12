import { type JSX } from 'react';
import type { Task, TabKey, UpdateTaskInput, User } from '../types';
import { formatGroupHeader, todayKey } from '../dates';
import { TaskRow } from './TaskRow';

interface TaskListProps {
  tab: TabKey;
  tasks: Task[]; // already filtered by assignee (admin filter) — full set for section computation
  currentUser: User;
  members: User[];
  expandedId: string | null;
  leavingIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onComplete: (task: Task) => void;
  onReopen: (task: Task) => void;
  onSave: (id: string, input: UpdateTaskInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface Group {
  key: string;
  header: string | null;
  tasks: Task[];
}

const EMPTY: Record<TabKey, { text: string }> = {
  today: { text: 'На сегодня всё сделано ✨' },
  upcoming: { text: 'Ничего не запланировано' },
  all: { text: 'Нет открытых задач' },
  logbook: { text: 'Журнал пуст' },
};

export function TaskList(props: TaskListProps): JSX.Element {
  const { tab, tasks } = props;
  const groups = computeGroups(tab, tasks, props.leavingIds);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);

  if (total === 0) {
    return (
      <div className="empty">
        <p className="empty__text">{EMPTY[tab].text}</p>
      </div>
    );
  }

  return (
    <div className="list">
      {groups.map((group) => (
        <section className="group" key={group.key}>
          {group.header && (
            <h2 className="group__header">{group.header}</h2>
          )}
          <div className="group__rows">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                currentUser={props.currentUser}
                members={props.members}
                expanded={props.expandedId === task.id}
                leaving={props.leavingIds.has(task.id)}
                onToggleExpand={props.onToggleExpand}
                onComplete={props.onComplete}
                onReopen={props.onReopen}
                onSave={props.onSave}
                onDelete={props.onDelete}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function computeGroups(tab: TabKey, tasks: Task[], leaving: Set<string>): Group[] {
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
