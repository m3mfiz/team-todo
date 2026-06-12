import { type JSX } from 'react';
import type { Task, TabKey, UpdateTaskInput, User } from '../types';
import { computeGroups } from '../grouping';
import { TaskRow } from './TaskRow';

interface TaskListProps {
  tab: TabKey;
  tasks: Task[]; // already filtered by assignee (admin filter) — full set for section computation
  currentUser: User;
  members: User[];
  expandedId: number | null;
  leavingIds: Set<number>;
  onToggleExpand: (id: number) => void;
  onComplete: (task: Task) => void;
  onReopen: (task: Task) => void;
  onSave: (id: number, input: UpdateTaskInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
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
