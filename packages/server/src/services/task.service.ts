import type { DB } from '../db/index.ts';
import { AppError } from '../utils/errors.ts';

interface CurrentUser {
  id: number;
  role: 'admin' | 'member';
}

interface TaskRow {
  id: number;
  title: string;
  notes: string;
  deadline: string | null;
  status: 'open' | 'done';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  creator_id: number;
  creator_name: string;
  assignee_id: number | null;
  assignee_name: string | null;
}

interface CompletionJson {
  userId: number;
  displayName: string;
  completedAt: string;
}

interface TaskJson {
  id: number;
  title: string;
  notes: string;
  deadline: string | null;
  status: 'open' | 'done';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creatorId: number;
  creatorName: string;
  assigneeId: number | null;
  assigneeName: string | null;
  // Present only on everyone-tasks (assignee_id IS NULL): per-member marks of
  // live members and whether the current user has marked the task done.
  completions?: CompletionJson[];
  myCompleted?: boolean;
}

const SELECT_BASE = `
  SELECT
    t.id            AS id,
    t.title         AS title,
    t.notes         AS notes,
    t.deadline      AS deadline,
    t.status        AS status,
    t.completed_at  AS completed_at,
    t.created_at    AS created_at,
    t.updated_at    AS updated_at,
    t.creator_id    AS creator_id,
    c.display_name  AS creator_name,
    t.assignee_id   AS assignee_id,
    a.display_name  AS assignee_name
  FROM tasks t
  JOIN users c ON c.id = t.creator_id
  LEFT JOIN users a ON a.id = t.assignee_id
`;

function toTaskJson(row: TaskRow): TaskJson {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    deadline: row.deadline,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
  };
}

interface CompletionRow {
  task_id: number;
  user_id: number;
  display_name: string;
  completed_at: string;
}

// Marks of live members only: soft-deleted users keep their rows in
// task_completions, but they never count towards (or show up in) completions.
const COMPLETION_USER_FILTER = `u.deleted_at IS NULL AND u.role = 'member'`;

function completionsByTask(
  db: DB,
  taskIds: number[],
): Map<number, CompletionJson[]> {
  const map = new Map<number, CompletionJson[]>();
  if (taskIds.length === 0) {
    return map;
  }
  const placeholders = taskIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT
         tc.task_id      AS task_id,
         tc.user_id      AS user_id,
         u.display_name  AS display_name,
         tc.completed_at AS completed_at
       FROM task_completions tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id IN (${placeholders})
         AND ${COMPLETION_USER_FILTER}
       ORDER BY u.display_name ASC, tc.user_id ASC`,
    )
    .all(...taskIds) as CompletionRow[];

  for (const row of rows) {
    const list = map.get(row.task_id) ?? [];
    list.push({
      userId: row.user_id,
      displayName: row.display_name,
      completedAt: row.completed_at,
    });
    map.set(row.task_id, list);
  }
  return map;
}

// Everyone-tasks carry completions + myCompleted; personal tasks stay as-is.
function enrichTaskJson(
  row: TaskRow,
  user: CurrentUser,
  completions: CompletionJson[],
): TaskJson {
  if (row.assignee_id !== null) {
    return toTaskJson(row);
  }
  return {
    ...toTaskJson(row),
    completions,
    myCompleted: completions.some((c) => c.userId === user.id),
  };
}

function enrichSingleTask(db: DB, row: TaskRow, user: CurrentUser): TaskJson {
  if (row.assignee_id !== null) {
    return toTaskJson(row);
  }
  const completions = completionsByTask(db, [row.id]).get(row.id) ?? [];
  return enrichTaskJson(row, user, completions);
}

function getTaskRow(db: DB, id: number): TaskRow | undefined {
  return db.prepare(`${SELECT_BASE} WHERE t.id = ?`).get(id) as
    | TaskRow
    | undefined;
}

function isVisible(row: TaskRow, user: CurrentUser): boolean {
  if (user.role === 'admin') {
    return true;
  }
  return (
    row.assignee_id === user.id ||
    row.assignee_id === null ||
    row.creator_id === user.id
  );
}

// Returns a visible task row or throws 404 (avoiding existence leaks).
function requireVisible(db: DB, id: number, user: CurrentUser): TaskRow {
  const row = getTaskRow(db, id);
  if (!row || !isVisible(row, user)) {
    throw AppError.notFound('Task not found');
  }
  return row;
}

const ORDER_BY = `
  ORDER BY
    CASE t.status WHEN 'open' THEN 0 ELSE 1 END ASC,
    CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END ASC,
    t.deadline ASC,
    t.created_at DESC
`;

export function listTasks(db: DB, user: CurrentUser): TaskJson[] {
  let rows: TaskRow[];
  if (user.role === 'admin') {
    rows = db.prepare(`${SELECT_BASE} ${ORDER_BY}`).all() as TaskRow[];
  } else {
    rows = db
      .prepare(
        `${SELECT_BASE}
         WHERE t.assignee_id = @uid OR t.assignee_id IS NULL OR t.creator_id = @uid
         ${ORDER_BY}`,
      )
      .all({ uid: user.id }) as TaskRow[];
  }
  // One extra query for all everyone-tasks in the list, grouped in JS.
  const everyoneIds = rows
    .filter((row) => row.assignee_id === null)
    .map((row) => row.id);
  const byTask = completionsByTask(db, everyoneIds);
  return rows.map((row) =>
    enrichTaskJson(row, user, byTask.get(row.id) ?? []),
  );
}

// Only live users are valid assignees; soft-deleted ones count as missing.
function userExists(db: DB, id: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  return row !== undefined;
}

interface CreateTaskInput {
  title: string;
  notes?: string;
  deadline?: string | null;
  assigneeId?: number | null;
}

export function createTask(
  db: DB,
  user: CurrentUser,
  input: CreateTaskInput,
): TaskJson {
  let assigneeId: number | null;

  if (user.role === 'member') {
    // Members may only create tasks assigned to themselves. undefined defaults
    // to self; an explicit other id or null ("everyone") is forbidden.
    if (input.assigneeId === undefined || input.assigneeId === user.id) {
      assigneeId = user.id;
    } else {
      throw AppError.forbidden(
        'Members can only create tasks assigned to themselves',
      );
    }
  } else {
    // Admin: explicit user id (must exist) or null = everyone.
    if (input.assigneeId === undefined || input.assigneeId === null) {
      assigneeId = null;
    } else {
      if (!userExists(db, input.assigneeId)) {
        throw AppError.badRequest('Assignee does not exist');
      }
      assigneeId = input.assigneeId;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO tasks (title, notes, deadline, creator_id, assignee_id)
       VALUES (@title, @notes, @deadline, @creatorId, @assigneeId)`,
    )
    .run({
      title: input.title,
      notes: input.notes ?? '',
      deadline: input.deadline ?? null,
      creatorId: user.id,
      assigneeId,
    });

  const row = getTaskRow(db, Number(info.lastInsertRowid));
  // Row was just inserted; guaranteed to exist.
  return enrichSingleTask(db, row as TaskRow, user);
}

// True when every live member (role='member', deleted_at IS NULL) has a mark
// on the task. An empty team never auto-completes anything.
function allLiveMembersCompleted(db: DB, taskId: number): boolean {
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN tc.id IS NULL THEN 1 ELSE 0 END) AS missing
       FROM users u
       LEFT JOIN task_completions tc
         ON tc.user_id = u.id AND tc.task_id = ?
       WHERE ${COMPLETION_USER_FILTER}`,
    )
    .get(taskId) as { total: number; missing: number | null };
  return counts.total > 0 && (counts.missing ?? 0) === 0;
}

// Sweep after team membership changes (e.g. soft-delete): an open everyone-task
// whose remaining live members have all marked it flips to done. Already-done
// tasks are never reopened by membership changes — the flip happens only at
// mark-time or in this sweep.
export function recomputeEveryoneTasksAfterUserChange(db: DB): void {
  const openEveryone = db
    .prepare(
      `SELECT id FROM tasks WHERE assignee_id IS NULL AND status = 'open'`,
    )
    .all() as Array<{ id: number }>;
  for (const task of openEveryone) {
    if (allLiveMembersCompleted(db, task.id)) {
      db.prepare(
        `UPDATE tasks
         SET status = 'done', completed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(task.id);
    }
  }
}

interface UpdateTaskPatch {
  title?: string;
  notes?: string;
  deadline?: string | null;
  assigneeId?: number | null;
  status?: 'open' | 'done';
}

export function updateTask(
  db: DB,
  user: CurrentUser,
  id: number,
  patch: UpdateTaskPatch,
): TaskJson {
  const row = requireVisible(db, id, user);

  const isCreator = row.creator_id === user.id;
  const isAdmin = user.role === 'admin';

  const wantsFieldEdit =
    patch.title !== undefined ||
    patch.notes !== undefined ||
    patch.deadline !== undefined ||
    patch.assigneeId !== undefined;

  if (wantsFieldEdit && !isCreator && !isAdmin) {
    throw AppError.forbidden('Only the creator or an admin can edit this task');
  }

  if (patch.assigneeId !== undefined && !isAdmin) {
    throw AppError.forbidden('Only an admin can change the assignee');
  }

  // Deadlines are set by the administrator; members cannot move them, even on
  // their own tasks (setting one at creation time is allowed).
  if (patch.deadline !== undefined && !isAdmin) {
    throw AppError.forbidden('Only an admin can change the deadline');
  }

  if (
    patch.assigneeId !== undefined &&
    patch.assigneeId !== null &&
    !userExists(db, patch.assigneeId)
  ) {
    throw AppError.badRequest('Assignee does not exist');
  }

  if (patch.status !== undefined && patch.status !== row.status) {
    const isAssignee = row.assignee_id === user.id;
    const isEveryone = row.assignee_id === null;
    const canChangeStatus =
      isAdmin ||
      isCreator ||
      isAssignee ||
      (isEveryone && user.role === 'member');
    if (!canChangeStatus) {
      throw AppError.forbidden(
        'You are not allowed to change the status of this task',
      );
    }
  }

  // Everyone-task + member changing status: the status patch is interpreted as
  // a personal mark, not a global flip. 'done' records the mark and completes
  // the task globally only once every live member has marked it; 'open'
  // removes the mark and reopens a globally-done task (including one
  // force-completed by an admin — deliberate for a 5-person team). Admin
  // status changes stay global and never touch the marks.
  const statusAsPersonalMark =
    patch.status !== undefined &&
    row.assignee_id === null &&
    user.role === 'member';

  if (statusAsPersonalMark) {
    const applyMark = db.transaction(() => {
      if (patch.status === 'done') {
        db.prepare(
          `INSERT OR IGNORE INTO task_completions (task_id, user_id)
           VALUES (?, ?)`,
        ).run(id, user.id);
        if (allLiveMembersCompleted(db, id)) {
          db.prepare(
            `UPDATE tasks
             SET status = 'done', completed_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`,
          ).run(id);
        } else {
          db.prepare(
            `UPDATE tasks SET updated_at = datetime('now') WHERE id = ?`,
          ).run(id);
        }
      } else {
        db.prepare(
          `DELETE FROM task_completions WHERE task_id = ? AND user_id = ?`,
        ).run(id, user.id);
        if (row.status === 'done') {
          db.prepare(
            `UPDATE tasks
             SET status = 'open', completed_at = NULL,
                 updated_at = datetime('now')
             WHERE id = ?`,
          ).run(id);
        } else {
          db.prepare(
            `UPDATE tasks SET updated_at = datetime('now') WHERE id = ?`,
          ).run(id);
        }
      }
    });
    applyMark();
  }

  const sets: string[] = [];
  const params: Record<string, unknown> = { id };

  if (patch.title !== undefined) {
    sets.push('title = @title');
    params.title = patch.title;
  }
  if (patch.notes !== undefined) {
    sets.push('notes = @notes');
    params.notes = patch.notes;
  }
  if (patch.deadline !== undefined) {
    sets.push('deadline = @deadline');
    params.deadline = patch.deadline;
  }
  if (patch.assigneeId !== undefined) {
    sets.push('assignee_id = @assigneeId');
    params.assigneeId = patch.assigneeId;
  }
  if (patch.status !== undefined && !statusAsPersonalMark) {
    sets.push('status = @status');
    params.status = patch.status;
    if (patch.status === 'done') {
      sets.push("completed_at = datetime('now')");
    } else {
      sets.push('completed_at = NULL');
    }
  }

  // A pure personal-mark patch already bumped updated_at inside the
  // transaction; skip the redundant generic UPDATE.
  if (sets.length > 0 || !statusAsPersonalMark) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(
      params,
    );
  }

  const updated = getTaskRow(db, id);
  return enrichSingleTask(db, updated as TaskRow, user);
}

export function deleteTask(db: DB, user: CurrentUser, id: number): void {
  const row = requireVisible(db, id, user);
  const isCreator = row.creator_id === user.id;
  const isAdmin = user.role === 'admin';
  if (!isCreator && !isAdmin) {
    throw AppError.forbidden('Only the creator or an admin can delete this task');
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
