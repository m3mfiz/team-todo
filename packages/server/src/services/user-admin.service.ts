import type Database from 'better-sqlite3';
import type { DB } from '../db/index.ts';
import { AppError } from '../utils/errors.ts';
import { hashPassword } from '../utils/password.ts';
import { recomputeEveryoneTasksAfterUserChange } from './task.service.ts';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
}

function usernameTaken(db: DB, username: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM users WHERE username = ? AND deleted_at IS NULL')
      .get(username) !== undefined
  );
}

export async function createUser(
  db: DB,
  input: CreateUserInput,
): Promise<PublicUser> {
  // Fast-fail before the (slow) bcrypt hash; uniqueness only counts live users —
  // soft-deleted ones are renamed to "<name>#del<id>" which can never collide
  // with a freshly validated username (no '#' allowed).
  if (usernameTaken(db, input.username)) {
    throw AppError.conflict('Username is already taken');
  }

  const passwordHash = await hashPassword(input.password);

  let info: Database.RunResult;
  try {
    info = db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role)
         VALUES (?, ?, ?, 'member')`,
      )
      .run(input.username, passwordHash, input.displayName);
  } catch (err) {
    // The UNIQUE constraint can still fire if a concurrent request inserted
    // the same username while we were hashing.
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      throw AppError.conflict('Username is already taken');
    }
    throw err;
  }

  return {
    id: Number(info.lastInsertRowid),
    username: input.username,
    displayName: input.displayName,
    role: 'member',
  };
}

export function softDeleteUser(
  db: DB,
  id: number,
  currentUserId: number,
): void {
  if (id === currentUserId) {
    throw AppError.badRequest('You cannot delete your own account');
  }

  const row = db
    .prepare(
      'SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL',
    )
    .get(id) as { id: number; username: string } | undefined;
  if (!row) {
    throw AppError.notFound('User not found');
  }

  const softDelete = db.transaction(() => {
    // Rename frees the login for reuse; tasks keep pointing at this row, so
    // creator/assignee display names stay resolvable via JOIN.
    db.prepare(
      `UPDATE users SET deleted_at = datetime('now'), username = ? WHERE id = ?`,
    ).run(`${row.username}#del${row.id}`, row.id);
    db.prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`,
    ).run(row.id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(row.id);
    // Completeness of everyone-tasks is computed over live members only, so
    // removing a member can make an open everyone-task complete: sweep now,
    // in the same transaction.
    recomputeEveryoneTasksAfterUserChange(db);
  });
  softDelete();
}

export async function setUserPassword(
  db: DB,
  id: number,
  password: string,
): Promise<void> {
  const row = db
    .prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  if (row === undefined) {
    throw AppError.notFound('User not found');
  }

  const passwordHash = await hashPassword(password);

  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      passwordHash,
      id,
    );
    // Force re-login everywhere: every outstanding refresh token is revoked.
    db.prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`,
    ).run(id);
  });
  apply();
}
