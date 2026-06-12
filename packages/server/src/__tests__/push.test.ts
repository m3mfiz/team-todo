import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, type LoginResult } from './setup.ts';
import type { DB } from '../db/index.ts';
import {
  computeNewTaskRecipients,
  notifyNewTask,
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

const SUB = {
  endpoint: 'https://push.example.com/sub-A',
  keys: { p256dh: 'p256dh-key-A', auth: 'auth-key-A' },
};

// Inserts a task directly and returns its id (bypasses notify wiring).
function insertTask(
  creatorId: number,
  opts: { title?: string; deadline?: string | null; assigneeId?: number | null; status?: 'open' | 'done' } = {},
): number {
  const info = db
    .prepare(
      `INSERT INTO tasks (title, notes, deadline, creator_id, assignee_id, status)
       VALUES (?, '', ?, ?, ?, ?)`,
    )
    .run(
      opts.title ?? 'T',
      opts.deadline ?? null,
      creatorId,
      opts.assigneeId ?? null,
      opts.status ?? 'open',
    );
  return Number(info.lastInsertRowid);
}

function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('push routes', () => {
  it('GET vapid-public-key returns 200 with a string|null publicKey', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/push/vapid-public-key',
      headers: authHeader(ivan.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const publicKey = res.json().publicKey as unknown;
    expect(publicKey === null || typeof publicKey === 'string').toBe(true);
  });

  it('vapid-public-key requires auth (401 without token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/push/vapid-public-key',
    });
    expect(res.statusCode).toBe(401);
  });

  it('subscribe stores a row, same user upserts, other user 409s, unsubscribe deletes own', async () => {
    // First subscribe by ivan.
    const sub1 = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: authHeader(ivan.accessToken),
      payload: SUB,
    });
    expect(sub1.statusCode).toBe(200);
    expect(sub1.json().ok).toBe(true);

    const row = db
      .prepare('SELECT user_id, p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
      .get(SUB.endpoint) as { user_id: number; p256dh: string; auth: string };
    expect(row.user_id).toBe(ivan.user.id);

    // Same user, same endpoint, new keys → upsert (200), keys refreshed.
    const sub2 = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: authHeader(ivan.accessToken),
      payload: { endpoint: SUB.endpoint, keys: { p256dh: 'new-p256', auth: 'new-auth' } },
    });
    expect(sub2.statusCode).toBe(200);
    const refreshed = db
      .prepare('SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
      .get(SUB.endpoint) as { p256dh: string; auth: string };
    expect(refreshed.p256dh).toBe('new-p256');
    expect(refreshed.auth).toBe('new-auth');

    // Another user claiming the same endpoint → 409.
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: authHeader(maria.accessToken),
      payload: SUB,
    });
    expect(conflict.statusCode).toBe(409);

    // maria unsubscribing the endpoint she does not own deletes nothing.
    const mariaUnsub = await app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      headers: authHeader(maria.accessToken),
      payload: { endpoint: SUB.endpoint },
    });
    expect(mariaUnsub.statusCode).toBe(200);
    expect(
      db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(SUB.endpoint),
    ).not.toBeUndefined();

    // ivan unsubscribing his own endpoint deletes the row.
    const ivanUnsub = await app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      headers: authHeader(ivan.accessToken),
      payload: { endpoint: SUB.endpoint },
    });
    expect(ivanUnsub.statusCode).toBe(200);
    expect(
      db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(SUB.endpoint),
    ).toBeUndefined();
  });
});

describe('computeNewTaskRecipients', () => {
  it('assigned → [assignee]; self-assigned → []; everyone → all minus creator', () => {
    expect(
      computeNewTaskRecipients(db, { assigneeId: maria.user.id, creatorId: admin.user.id }),
    ).toEqual([maria.user.id]);

    expect(
      computeNewTaskRecipients(db, { assigneeId: ivan.user.id, creatorId: ivan.user.id }),
    ).toEqual([]);

    const everyone = computeNewTaskRecipients(db, {
      assigneeId: null,
      creatorId: admin.user.id,
    });
    const allIds = (db.prepare('SELECT id FROM users').all() as Array<{ id: number }>).map(
      (r) => r.id,
    );
    expect([...everyone].sort()).toEqual(allIds.filter((id) => id !== admin.user.id).sort());
  });
});

describe('notifyNewTask dedupe', () => {
  it('calls send once per recipient and never twice for the same task', async () => {
    const taskId = insertTask(admin.user.id, { title: 'Notify me', assigneeId: ivan.user.id });
    const calls: Array<{ userId: number; payload: PushPayload }> = [];
    const fakeSend = async (_db: DB, userId: number, payload: PushPayload) => {
      calls.push({ userId, payload });
    };

    await notifyNewTask(
      db,
      { id: taskId, title: 'Notify me', deadline: null, assigneeId: ivan.user.id, creatorId: admin.user.id },
      fakeSend,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe(ivan.user.id);
    expect(calls[0].payload.title).toBe('Новая задача');
    expect(calls[0].payload.body).toBe('Notify me');

    // Second run for the same task → dedupe → no calls.
    await notifyNewTask(
      db,
      { id: taskId, title: 'Notify me', deadline: null, assigneeId: ivan.user.id, creatorId: admin.user.id },
      fakeSend,
    );
    expect(calls).toHaveLength(1);
  });

  it('appends the deadline to the body when present', async () => {
    const taskId = insertTask(admin.user.id, {
      title: 'Dated',
      deadline: '2026-09-09',
      assigneeId: maria.user.id,
    });
    const calls: PushPayload[] = [];
    await notifyNewTask(
      db,
      { id: taskId, title: 'Dated', deadline: '2026-09-09', assigneeId: maria.user.id, creatorId: admin.user.id },
      async (_db, _uid, payload) => {
        calls.push(payload);
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBe('Dated · до 2026-09-09');
  });
});

describe('deadline reminders', () => {
  it('fires d7/d3/d1 for open tasks only, dedupes on re-run, expands everyone-tasks', async () => {
    const today = '2026-06-12';
    const now = new Date(`${today}T09:00:00Z`);

    // Tasks at each offset.
    const t7 = insertTask(admin.user.id, { title: 't7', deadline: addDays(today, 7), assigneeId: ivan.user.id });
    const t3 = insertTask(admin.user.id, { title: 't3', deadline: addDays(today, 3), assigneeId: ivan.user.id });
    const t1 = insertTask(admin.user.id, { title: 't1', deadline: addDays(today, 1), assigneeId: ivan.user.id });
    const t2 = insertTask(admin.user.id, { title: 't2', deadline: addDays(today, 2), assigneeId: ivan.user.id });
    const tNone = insertTask(admin.user.id, { title: 'tNone', deadline: null, assigneeId: ivan.user.id });
    const tDone = insertTask(admin.user.id, {
      title: 'tDone',
      deadline: addDays(today, 3),
      assigneeId: ivan.user.id,
      status: 'done',
    });
    const tEveryone = insertTask(admin.user.id, {
      title: 'tEveryone',
      deadline: addDays(today, 1),
      assigneeId: null,
    });

    const reminders = computeDeadlineReminders(db, today);
    const byId = new Map(reminders.map((r) => [r.taskId, r]));
    expect(byId.get(t7)?.kind).toBe('d7');
    expect(byId.get(t3)?.kind).toBe('d3');
    expect(byId.get(t1)?.kind).toBe('d1');
    // +2, none, and done are excluded.
    expect(byId.has(t2)).toBe(false);
    expect(byId.has(tNone)).toBe(false);
    expect(byId.has(tDone)).toBe(false);
    // everyone-task expands to all users.
    const allIds = (db.prepare('SELECT id FROM users').all() as Array<{ id: number }>).map(
      (r) => r.id,
    );
    expect([...(byId.get(tEveryone)?.recipientIds ?? [])].sort()).toEqual([...allIds].sort());

    // runDeadlineReminders with fake send: counts per-recipient sends.
    const calls: Array<{ userId: number; payload: PushPayload }> = [];
    const fakeSend = async (_db: DB, userId: number, payload: PushPayload) => {
      calls.push({ userId, payload });
    };
    await runDeadlineReminders(db, now, fakeSend);

    // t7/t3/t1 → 1 recipient (ivan) each = 3; everyone d1 → all users.
    const expectedSends = 3 + allIds.length;
    expect(calls).toHaveLength(expectedSends);
    const d1Call = calls.find((c) => c.userId === ivan.user.id && c.payload.body === 't1');
    expect(d1Call?.payload.title).toBe('Завтра срок задачи');
    const d3Call = calls.find((c) => c.payload.body === 't3');
    expect(d3Call?.payload.title).toBe('Срок через 3 дня');
    const d7Call = calls.find((c) => c.payload.body === 't7');
    expect(d7Call?.payload.title).toBe('Срок через 7 дней');

    // Second run same now → fully deduped → no new sends.
    const calls2: unknown[] = [];
    await runDeadlineReminders(db, now, async () => {
      calls2.push(1);
    });
    expect(calls2).toHaveLength(0);
  });
});
