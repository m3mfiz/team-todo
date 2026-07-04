import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, login, type LoginResult } from './setup.ts';
import type { DB } from '../db/index.ts';
import { runDailyGc } from '../services/reminder-cron.ts';

let app: FastifyInstance;
let db: DB;
let dbPath: string;
let ivan: LoginResult;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  db = (app as FastifyInstance & { db: DB }).db;
  ivan = await login(app, 'ivan', 'ivan123');
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

function insertToken(
  hash: string,
  expiresAt: string,
  revokedAt: string | null = null,
): void {
  db.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, expires_at, revoked_at) VALUES (?, ?, ?, ?)',
  ).run(hash, ivan.user.id, expiresAt, revokedAt);
}

function insertTask(
  status: 'open' | 'done',
  completedDaysAgo: number | null,
): number {
  const info = db
    .prepare(
      `INSERT INTO tasks (title, notes, creator_id, status, completed_at)
       VALUES ('G', '', ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '-' || ? || ' days') END)`,
    )
    .run(ivan.user.id, status, completedDaysAgo, completedDaysAgo);
  return Number(info.lastInsertRowid);
}

function insertSentLog(taskId: number): void {
  db.prepare(
    "INSERT INTO push_sent_log (task_id, user_id, kind) VALUES (?, ?, 'new')",
  ).run(taskId, ivan.user.id);
}

describe('runDailyGc', () => {
  it('deletes expired refresh tokens but keeps revoked-yet-unexpired ones', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    insertToken('gc-expired', past);
    insertToken('gc-expired-revoked', past, past);
    insertToken('gc-revoked-live', future, past);
    insertToken('gc-live', future);

    runDailyGc(db);

    const hashes = (
      db.prepare('SELECT token_hash FROM refresh_tokens').all() as Array<{
        token_hash: string;
      }>
    ).map((r) => r.token_hash);
    expect(hashes).not.toContain('gc-expired');
    expect(hashes).not.toContain('gc-expired-revoked');
    // Family-revocation reuse detection depends on revoked rows surviving
    // until they actually expire.
    expect(hashes).toContain('gc-revoked-live');
    expect(hashes).toContain('gc-live');
  });

  it('deletes push logs only for tasks done more than 90 days ago', () => {
    const oldDone = insertTask('done', 100);
    const recentDone = insertTask('done', 10);
    const open = insertTask('open', null);
    insertSentLog(oldDone);
    insertSentLog(recentDone);
    insertSentLog(open);

    runDailyGc(db);

    const logTaskIds = (
      db.prepare('SELECT task_id FROM push_sent_log').all() as Array<{
        task_id: number;
      }>
    ).map((r) => r.task_id);
    expect(logTaskIds).not.toContain(oldDone);
    expect(logTaskIds).toContain(recentDone);
    expect(logTaskIds).toContain(open);
  });
});
