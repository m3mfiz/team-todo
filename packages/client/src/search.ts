import type { Task } from './types';
import type { Group } from './grouping';

// Case-insensitive substring match on title OR notes across all visible tasks.
export function filterTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tasks.filter((t) => {
    const title = t.title.toLowerCase();
    const notes = (t.notes ?? '').toLowerCase();
    return title.includes(q) || notes.includes(q);
  });
}

// Splits search matches into «Открытые» / «Журнал» groups, omitting empty ones.
export function groupSearchResults(matches: Task[]): Group[] {
  const open = matches.filter((t) => t.status === 'open');
  const done = matches.filter((t) => t.status === 'done');
  const groups: Group[] = [];
  if (open.length) groups.push({ key: 'search-open', header: 'Открытые', tasks: open });
  if (done.length) groups.push({ key: 'search-done', header: 'Журнал', tasks: done });
  return groups;
}
