import { type JSX } from 'react';
import type { Task, TabKey, UpdateTaskInput, User } from '../types';
import { computeGroups } from '../grouping';
import { filterTasks, groupSearchResults } from '../search';
import { TaskRow } from './TaskRow';
import { SearchIcon } from '../icons';
import { TAB_ICON } from '../tabs';

interface TaskListProps {
  tab: TabKey;
  tasks: Task[]; // filtered by assignee (admin filter) when not searching; unfiltered while a Quick Find query is active
  currentUser: User;
  members: User[];
  expandedId: number | null;
  leavingIds: Set<number>;
  searchQuery?: string;
  onToggleExpand: (id: number) => void;
  onComplete: (task: Task) => void;
  onReopen: (task: Task) => void;
  onSave: (id: number, input: UpdateTaskInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const EMPTY_TEXT: Record<TabKey, string> = {
  today: 'На сегодня всё сделано ✨',
  upcoming: 'Ничего не запланировано',
  all: 'Нет открытых задач',
  logbook: 'Журнал пуст',
};

export function TaskList(props: TaskListProps): JSX.Element {
  const { tab, tasks } = props;
  const query = props.searchQuery?.trim() ?? '';
  const isSearching = query.length > 0;
  const groups = isSearching
    ? groupSearchResults(filterTasks(tasks, query))
    : computeGroups(tab, tasks, props.leavingIds);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);

  if (total === 0) {
    if (isSearching) {
      return (
        <div className="empty">
          <span className="empty__icon" aria-hidden="true">
            <SearchIcon size={48} />
          </span>
          <p className="empty__text">Ничего не найдено</p>
        </div>
      );
    }
    const { icon: Icon, colorVar } = TAB_ICON[tab];
    return (
      <div className="empty">
        <span className="empty__icon" style={{ color: colorVar }} aria-hidden="true">
          <Icon size={48} />
        </span>
        <p className="empty__text">{EMPTY_TEXT[tab]}</p>
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
                highlightQuery={isSearching ? query : undefined}
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
