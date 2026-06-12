import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, type LoginResult } from './setup.ts';

let app: FastifyInstance;
let dbPath: string;
let admin: LoginResult;
let ivan: LoginResult;
let maria: LoginResult;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  admin = await login(app, 'admin', 'admin123');
  ivan = await login(app, 'ivan', 'ivan123');
  maria = await login(app, 'maria', 'maria123');
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

async function listTaskIds(token: string): Promise<number[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: authHeader(token),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: number }>).map((t) => t.id);
}

async function createTask(
  token: string,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: authHeader(token),
    payload: body,
  });
}

describe('tasks', () => {
  it('rejects unauthenticated GET /api/tasks with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('admin assigns a task to ivan: ivan sees it, maria does not', async () => {
    const res = await createTask(admin.accessToken, {
      title: 'Task for ivan',
      assigneeId: ivan.user.id,
    });
    expect(res.statusCode).toBe(201);
    const taskId = res.json().id as number;

    expect(await listTaskIds(ivan.accessToken)).toContain(taskId);
    expect(await listTaskIds(maria.accessToken)).not.toContain(taskId);
    expect(await listTaskIds(admin.accessToken)).toContain(taskId);
  });

  it('admin creates an everyone-task: ivan and maria both see it', async () => {
    const res = await createTask(admin.accessToken, {
      title: 'Everyone task',
      assigneeId: null,
    });
    expect(res.statusCode).toBe(201);
    const taskId = res.json().id as number;
    expect(res.json().assigneeId).toBeNull();

    expect(await listTaskIds(ivan.accessToken)).toContain(taskId);
    expect(await listTaskIds(maria.accessToken)).toContain(taskId);
  });

  it('ivan creates own task: ivan + admin see it, maria does not', async () => {
    const res = await createTask(ivan.accessToken, { title: 'Ivan own task' });
    expect(res.statusCode).toBe(201);
    const taskId = res.json().id as number;
    expect(res.json().assigneeId).toBe(ivan.user.id);

    expect(await listTaskIds(ivan.accessToken)).toContain(taskId);
    expect(await listTaskIds(admin.accessToken)).toContain(taskId);
    expect(await listTaskIds(maria.accessToken)).not.toContain(taskId);
  });

  it('member cannot create a task assigned to another member (403)', async () => {
    const res = await createTask(ivan.accessToken, {
      title: 'Bad assign',
      assigneeId: maria.user.id,
    });
    expect(res.statusCode).toBe(403);
  });

  it('member cannot create an everyone-task (403)', async () => {
    const res = await createTask(ivan.accessToken, {
      title: 'Bad everyone',
      assigneeId: null,
    });
    expect(res.statusCode).toBe(403);
  });

  it('member completes own task and can reopen it', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Complete me',
    });
    const taskId = created.json().id as number;

    const done = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { status: 'done' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('done');
    expect(done.json().completedAt).not.toBeNull();

    const reopen = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { status: 'open' },
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().status).toBe('open');
    expect(reopen.json().completedAt).toBeNull();
  });

  it('maria can complete an everyone-task', async () => {
    const created = await createTask(admin.accessToken, {
      title: 'Everyone to complete',
      assigneeId: null,
    });
    const taskId = created.json().id as number;

    const done = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(maria.accessToken),
      payload: { status: 'done' },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('done');
  });

  it('assignee cannot edit title of admin-created task but can complete it', async () => {
    const created = await createTask(admin.accessToken, {
      title: 'Admin task for ivan',
      assigneeId: ivan.user.id,
    });
    const taskId = created.json().id as number;

    const editTitle = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { title: 'Renamed by ivan' },
    });
    expect(editTitle.statusCode).toBe(403);

    const complete = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { status: 'done' },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe('done');
  });

  it('member cannot delete admin-created task; admin can delete any', async () => {
    const created = await createTask(admin.accessToken, {
      title: 'Admin owned',
      assigneeId: ivan.user.id,
    });
    const taskId = created.json().id as number;

    const ivanDelete = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
    });
    expect(ivanDelete.statusCode).toBe(403);

    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(admin.accessToken),
    });
    expect(adminDelete.statusCode).toBe(200);

    expect(await listTaskIds(admin.accessToken)).not.toContain(taskId);
  });

  // Contract lock: assigneeId must be a JSON number. A string id (e.g. a raw
  // <select>.value passed through by a client) must be rejected, not coerced.
  it('rejects string assigneeId with 400 on create and update', async () => {
    const asString = await createTask(admin.accessToken, {
      title: 'String id must fail',
      assigneeId: String(ivan.user.id),
    });
    expect(asString.statusCode).toBe(400);

    const created = await createTask(admin.accessToken, {
      title: 'Patch target',
      assigneeId: ivan.user.id,
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as number;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(admin.accessToken),
      payload: { assigneeId: String(maria.user.id) },
    });
    expect(patched.statusCode).toBe(400);
  });
});
