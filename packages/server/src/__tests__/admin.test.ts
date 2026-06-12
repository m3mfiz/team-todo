import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, nextTestIp } from './setup.ts';
import type { DB } from '../db/index.ts';
import {
  computeDeadlineReminders,
  computeNewTaskRecipients,
} from '../services/notify.service.ts';

let app: FastifyInstance;
let db: DB;
let dbPath: string;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  db = (app as FastifyInstance & { db: DB }).db;
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

async function adminToken(): Promise<{ accessToken: string; id: number }> {
  const result = await login(app, 'admin', 'admin123');
  return { accessToken: result.accessToken, id: result.user.id };
}

function rawLogin(username: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-forwarded-for': nextTestIp() },
    payload: { username, password },
  });
}

describe('admin access control', () => {
  it('rejects members on all three admin endpoints with 403', async () => {
    const { accessToken } = await login(app, 'ivan', 'ivan123');
    const headers = authHeader(accessToken);

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers,
      payload: { username: 'newbie', displayName: 'Newbie', password: 'secret1' },
    });
    expect(create.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/admin/users/1',
      headers,
    });
    expect(del.statusCode).toBe(403);

    const pw = await app.inject({
      method: 'POST',
      url: '/api/admin/users/1/password',
      headers,
      payload: { password: 'secret1' },
    });
    expect(pw.statusCode).toBe(403);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { username: 'nope', displayName: 'Nope', password: 'secret1' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/admin/users', () => {
  it('creates a member who can then log in', async () => {
    const { accessToken } = await adminToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: authHeader(accessToken),
      payload: { username: 'petya', displayName: 'Пётр', password: 'petya123' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      username: 'petya',
      displayName: 'Пётр',
      role: 'member',
    });
    expect(body.id).toBeTypeOf('number');

    const loginRes = await login(app, 'petya', 'petya123');
    expect(loginRes.user.username).toBe('petya');
    expect(loginRes.user.role).toBe('member');
  });

  it('returns 409 for a username taken by a live user', async () => {
    const { accessToken } = await adminToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: authHeader(accessToken),
      payload: { username: 'ivan', displayName: 'Клон', password: 'secret1' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 for invalid usernames', async () => {
    const { accessToken } = await adminToken();
    for (const username of ['ab', 'Ivan', '1user', 'has space', 'тест', 'a'.repeat(31)]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: authHeader(accessToken),
        payload: { username, displayName: 'X', password: 'secret1' },
      });
      expect(res.statusCode, `username "${username}"`).toBe(400);
    }
  });

  it('returns 400 for invalid passwords and display names', async () => {
    const { accessToken } = await adminToken();
    const headers = authHeader(accessToken);

    const shortPw = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers,
      payload: { username: 'okuser', displayName: 'Ok', password: '12345' },
    });
    expect(shortPw.statusCode).toBe(400);

    const longPw = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers,
      payload: { username: 'okuser', displayName: 'Ok', password: 'x'.repeat(73) },
    });
    expect(longPw.statusCode).toBe(400);

    const emptyName = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers,
      payload: { username: 'okuser', displayName: '', password: 'secret1' },
    });
    expect(emptyName.statusCode).toBe(400);
  });
});

describe('DELETE /api/admin/users/:id (soft delete)', () => {
  it('soft-deletes a user with all side effects', async () => {
    const admin = await adminToken();
    const adminHeaders = authHeader(admin.accessToken);

    // Create the victim and let them log in + create a task.
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: adminHeaders,
      payload: { username: 'victim', displayName: 'Жертва', password: 'victim123' },
    });
    expect(created.statusCode).toBe(201);
    const victimId = created.json().id as number;

    const victim = await login(app, 'victim', 'victim123');
    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(victim.accessToken),
      payload: { title: 'Задача жертвы' },
    });
    expect(taskRes.statusCode).toBe(201);
    const taskId = taskRes.json().id as number;

    // Give the victim a push subscription to verify cleanup.
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)`,
    ).run(victimId, 'https://push.example/victim', 'p256dh-key', 'auth-key');

    // Delete.
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${victimId}`,
      headers: adminHeaders,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    // Login of the deleted user fails.
    const loginRes = await rawLogin('victim', 'victim123');
    expect(loginRes.statusCode).toBe(401);

    // Their refresh token is revoked.
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: victim.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    // Gone from GET /api/users.
    const usersRes = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: adminHeaders,
    });
    expect(usersRes.statusCode).toBe(200);
    const userIds = (usersRes.json() as Array<{ id: number }>).map((u) => u.id);
    expect(userIds).not.toContain(victimId);

    // Their task is still visible to the admin with the display name intact.
    const tasksRes = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: adminHeaders,
    });
    expect(tasksRes.statusCode).toBe(200);
    const task = (tasksRes.json() as Array<{ id: number; creatorName: string }>).find(
      (t) => t.id === taskId,
    );
    expect(task).toBeDefined();
    expect(task?.creatorName).toBe('Жертва');

    // Push subscriptions are removed.
    const subs = db
      .prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ?')
      .all(victimId);
    expect(subs).toHaveLength(0);

    // The username is freed: a new user with the same login can be created.
    const recreate = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: adminHeaders,
      payload: { username: 'victim', displayName: 'Жертва 2', password: 'victim456' },
    });
    expect(recreate.statusCode).toBe(201);
    expect(recreate.json().id).not.toBe(victimId);

    // Deleting the same (already deleted) id again -> 404.
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${victimId}`,
      headers: adminHeaders,
    });
    expect(again.statusCode).toBe(404);
  });

  it('rejects admin self-deletion with 400', async () => {
    const admin = await adminToken();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${admin.id}`,
      headers: authHeader(admin.accessToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a nonexistent user id', async () => {
    const admin = await adminToken();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/users/999999',
      headers: authHeader(admin.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/admin/users/:id/password', () => {
  it('changes the password and revokes existing refresh tokens', async () => {
    const admin = await adminToken();
    const adminHeaders = authHeader(admin.accessToken);

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: adminHeaders,
      payload: { username: 'pwuser', displayName: 'Сменщик', password: 'oldpass1' },
    });
    expect(created.statusCode).toBe(201);
    const pwUserId = created.json().id as number;

    const session = await login(app, 'pwuser', 'oldpass1');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${pwUserId}/password`,
      headers: adminHeaders,
      payload: { password: 'newpass1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Old password no longer works.
    const oldLogin = await rawLogin('pwuser', 'oldpass1');
    expect(oldLogin.statusCode).toBe(401);

    // New password works.
    const newLogin = await rawLogin('pwuser', 'newpass1');
    expect(newLogin.statusCode).toBe(200);

    // The pre-change refresh token is revoked.
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('returns 400 for an invalid password', async () => {
    const admin = await adminToken();
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${admin.id}/password`,
      headers: authHeader(admin.accessToken),
      payload: { password: '123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a nonexistent user id', async () => {
    const admin = await adminToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users/999999/password',
      headers: authHeader(admin.accessToken),
      payload: { password: 'newpass1' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('push recipients exclude soft-deleted users', () => {
  it('computeNewTaskRecipients and computeDeadlineReminders skip deleted users', async () => {
    const admin = await adminToken();
    const adminHeaders = authHeader(admin.accessToken);

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: adminHeaders,
      payload: { username: 'ghost', displayName: 'Призрак', password: 'ghost123' },
    });
    expect(created.statusCode).toBe(201);
    const ghostId = created.json().id as number;

    // Before deletion the ghost is among the "everyone" recipients.
    const before = computeNewTaskRecipients(db, {
      assigneeId: null,
      creatorId: admin.id,
    });
    expect(before).toContain(ghostId);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${ghostId}`,
      headers: adminHeaders,
    });
    expect(del.statusCode).toBe(200);

    const after = computeNewTaskRecipients(db, {
      assigneeId: null,
      creatorId: admin.id,
    });
    expect(after).not.toContain(ghostId);
    expect(after).not.toContain(admin.id);

    // Deadline reminders for an "everyone" task also exclude the deleted user.
    db.prepare(
      `INSERT INTO tasks (title, creator_id, assignee_id, deadline, status)
       VALUES ('Everyone deadline', ?, NULL, '2099-01-08', 'open')`,
    ).run(admin.id);

    const reminders = computeDeadlineReminders(db, '2099-01-01');
    const reminder = reminders.find((r) => r.deadline === '2099-01-08');
    expect(reminder).toBeDefined();
    expect(reminder?.kind).toBe('d7');
    expect(reminder?.recipientIds).not.toContain(ghostId);
    expect(reminder?.recipientIds).toContain(admin.id);
  });
});
