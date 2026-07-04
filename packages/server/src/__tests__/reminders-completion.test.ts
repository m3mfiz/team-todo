import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, type LoginResult } from './setup.ts';
import type { DB } from '../db/index.ts';
import {
  computeDeadlineReminders,
  runDeadlineReminders,
} from '../services/notify.service.ts';
import type { PushPayload } from '../services/push.service.ts';

let app: FastifyInstance;
let db: DB;
let dbPath: string;
let admin: LoginResult;
let ivan: LoginResult;
let maria: LoginResult;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  db = (app as FastifyInstance & { db: DB }).db;
  admin = await login(app, 'admin', 'admin123');
  ivan = await login(app, 'ivan', 'ivan123');
  maria = await login(app, 'maria', 'maria123');
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

function insertTask(
  creatorId: number,
  opts: { title?: string; deadline?: string | null; assigneeId?: number | null } = {},
): number {
  const info = db
    .prepare(
      `INSERT INTO tasks (title, notes, deadline, creator_id, assignee_id)
       VALUES (?, '', ?, ?, ?)`,
    )
    .run(opts.title ?? 'T', opts.deadline ?? null, creatorId, opts.assigneeId ?? null);
  return Number(info.lastInsertRowid);
}

function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('deadline reminders vs per-member completions', () => {
  const today = '2026-06-12';
  let everyoneTask: number;
  let personalTask: number;

  it('member who marked an everyone-task is excluded; others and admin remain', async () => {
    everyoneTask = insertTask(admin.user.id, {
      title: 'shared d3',
      deadline: addDays(today, 3),
      assigneeId: null,
    });
    personalTask = insertTask(admin.user.id, {
      title: 'personal d3',
      deadline: addDays(today, 3),
      assigneeId: ivan.user.id,
    });

    // ivan marks his part of the everyone-task via the API.
    const marked = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${everyoneTask}`,
      headers: authHeader(ivan.accessToken),
      payload: { status: 'done' },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().status).toBe('open');

    const reminders = computeDeadlineReminders(db, today);
    const byId = new Map(reminders.map((r) => [r.taskId, r]));

    const shared = byId.get(everyoneTask);
    expect(shared?.kind).toBe('d3');
    expect(shared?.recipientIds).not.toContain(ivan.user.id);
    expect(shared?.recipientIds).toContain(maria.user.id);
    expect(shared?.recipientIds).toContain(admin.user.id);
    const allIds = (
      db.prepare('SELECT id FROM users WHERE deleted_at IS NULL').all() as Array<{ id: number }>
    ).map((r) => r.id);
    expect([...(shared?.recipientIds ?? [])].sort()).toEqual(
      allIds.filter((id) => id !== ivan.user.id).sort(),
    );

    // Personal-task reminders are unchanged: ivan still gets his own.
    expect(byId.get(personalTask)?.recipientIds).toEqual([ivan.user.id]);
  });

  it('runDeadlineReminders sends accordingly (fake sender captures recipients)', async () => {
    const now = new Date(`${today}T09:00:00Z`);
    const calls: Array<{ userId: number; payload: PushPayload }> = [];
    await runDeadlineReminders(db, now, async (_db, userId, payload) => {
      calls.push({ userId, payload });
    });

    const sharedCalls = calls.filter((c) => c.payload.body === 'shared d3');
    expect(sharedCalls.map((c) => c.userId)).not.toContain(ivan.user.id);
    expect(sharedCalls.map((c) => c.userId)).toContain(maria.user.id);
    expect(sharedCalls.map((c) => c.userId)).toContain(admin.user.id);

    const personalCalls = calls.filter((c) => c.payload.body === 'personal d3');
    expect(personalCalls.map((c) => c.userId)).toEqual([ivan.user.id]);
  });

  it('admin with a completion row is excluded too', async () => {
    db.prepare(
      `INSERT OR IGNORE INTO task_completions (task_id, user_id) VALUES (?, ?)`,
    ).run(everyoneTask, admin.user.id);

    const reminders = computeDeadlineReminders(db, today);
    const shared = reminders.find((r) => r.taskId === everyoneTask);
    expect(shared?.recipientIds).not.toContain(admin.user.id);
    expect(shared?.recipientIds).not.toContain(ivan.user.id);
    expect(shared?.recipientIds).toContain(maria.user.id);
  });
});
