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
  return rows.map(toTaskJson);
}

function userExists(db: DB, id: number): boolean {
  const row = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
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
  return toTaskJson(row as TaskRow);
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
  if (patch.status !== undefined) {
    sets.push('status = @status');
    params.status = patch.status;
    if (patch.status === 'done') {
      sets.push("completed_at = datetime('now')");
    } else {
      sets.push('completed_at = NULL');
    }
  }

  sets.push("updated_at = datetime('now')");

  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);

  const updated = getTaskRow(db, id);
  return toTaskJson(updated as TaskRow);
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
