import { createHash } from 'node:crypto';
import type { DB } from '../db/index.ts';
import { verifyPassword } from '../utils/password.ts';
import { AppError } from '../utils/errors.ts';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: 'admin' | 'member';
  created_at: string;
  deleted_at: string | null;
}

const REFRESH_TTL_DAYS = 7;

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function expiresAtIso(days: number): string {
  const ms = Date.now() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

// Soft-deleted users are treated as non-existent: auth/me and the refresh
// re-read both resolve to 401 for them.
export function getUserById(db: DB, id: number): UserRow | undefined {
  return db
    .prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(id) as UserRow | undefined;
}

export async function login(
  db: DB,
  username: string,
  password: string,
): Promise<UserRow | null> {
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL')
    .get(username) as UserRow | undefined;
  if (!user) {
    // Equalize timing with the found-user path to avoid username enumeration.
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? user : null;
}

// bcrypt(10) of a throwaway string; only used to burn comparable time above.
const DUMMY_HASH = '$2a$10$2t0Ok6qQ5hcWflALuKiS1uTTzM0GIP0w.biLK5TvG7rls4J6ogyvS';

export function storeRefreshToken(
  db: DB,
  userId: number,
  token: string,
): void {
  db.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(sha256(token), userId, expiresAtIso(REFRESH_TTL_DAYS));
}

interface RefreshRow {
  id: number;
  token_hash: string;
  user_id: number;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Rotate a refresh token. Returns the user id the new token should belong to.
 * Detects replay of an already-revoked token and triggers family revocation.
 * The caller is responsible for signing the new JWT and calling
 * storeRefreshToken with it.
 */
export function rotateRefreshToken(db: DB, token: string): number {
  const hash = sha256(token);
  const row = db
    .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .get(hash) as RefreshRow | undefined;

  if (!row) {
    throw AppError.unauthorized('Invalid refresh token');
  }

  if (row.revoked_at !== null) {
    // Token reuse detected: revoke the entire token family for this user.
    db.prepare(
      'UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE user_id = ? AND revoked_at IS NULL',
    ).run(row.user_id);
    throw AppError.unauthorized('Refresh token reuse detected');
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw AppError.unauthorized('Refresh token expired');
  }

  db.prepare(
    'UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ?',
  ).run(row.id);

  return row.user_id;
}

export function revokeToken(db: DB, token: string): void {
  db.prepare(
    'UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE token_hash = ? AND revoked_at IS NULL',
  ).run(sha256(token));
}
