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
let sergey: LoginResult;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  admin = await login(app, 'admin', 'admin123');
  ivan = await login(app, 'ivan', 'ivan123');
  maria = await login(app, 'maria', 'maria123');
  sergey = await login(app, 'sergey', 'sergey123');
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

  // Per-member completion contract: a member's 'done' on an everyone-task
  // records a personal mark (myCompleted), while the global status honestly
  // stays 'open' until every live member has marked it.
  it('maria can complete an everyone-task: myCompleted true, global stays open', async () => {
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
    expect(done.json().status).toBe('open');
    expect(done.json().completedAt).toBeNull();
    expect(done.json().myCompleted).toBe(true);
    const completions = done.json().completions as Array<{ userId: number }>;
    expect(completions.some((c) => c.userId === maria.user.id)).toBe(true);
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

  it('maria cannot complete ivan\'s personal task: 404 (no existence leak)', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Ivan private',
    });
    const taskId = created.json().id as number;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(maria.accessToken),
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('assignee (not creator) can complete but cannot edit title or delete', async () => {
    const created = await createTask(admin.accessToken, {
      title: 'Admin task assigned to ivan',
      assigneeId: ivan.user.id,
    });
    const taskId = created.json().id as number;

    const complete = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { status: 'done' },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe('done');

    const editTitle = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { title: 'Ivan renamed' },
    });
    expect(editTitle.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
    });
    expect(del.statusCode).toBe(403);
  });

  it('member cannot change the assignee of his own task (403)', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Ivan reassign attempt',
    });
    const taskId = created.json().id as number;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { assigneeId: maria.user.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH deadline null clears it; a title-only PATCH leaves deadline untouched', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Has deadline',
      deadline: '2026-09-01',
    });
    const taskId = created.json().id as number;
    expect(created.json().deadline).toBe('2026-09-01');

    // Title-only patch must not touch the deadline.
    const titleOnly = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { title: 'Renamed, deadline kept' },
    });
    expect(titleOnly.statusCode).toBe(200);
    expect(titleOnly.json().deadline).toBe('2026-09-01');

    // Replacing the deadline works (admin — members cannot move deadlines).
    const replace = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(admin.accessToken),
      payload: { deadline: '2027-01-15' },
    });
    expect(replace.statusCode).toBe(200);
    expect(replace.json().deadline).toBe('2027-01-15');

    // null clears it (admin).
    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(admin.accessToken),
      payload: { deadline: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().deadline).toBeNull();
  });

  it('member cannot change the deadline even on his own task (403); admin can', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Ivan plans himself',
      deadline: '2026-10-01',
    });
    const taskId = created.json().id as number;

    const ivanMove = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { deadline: '2026-11-01' },
    });
    expect(ivanMove.statusCode).toBe(403);

    const adminMove = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(admin.accessToken),
      payload: { deadline: '2026-11-01' },
    });
    expect(adminMove.statusCode).toBe(200);
    expect(adminMove.json().deadline).toBe('2026-11-01');
  });

  // Regression: the client editor sends notes:null for tasks without notes;
  // this used to 400 the whole PATCH (including title edits).
  it('PATCH with notes:null succeeds and clears notes to empty string', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'No notes task',
      notes: 'temp',
    });
    const taskId = created.json().id as number;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { title: 'Edited fine', notes: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Edited fine');
    expect(res.json().notes).toBe('');
  });

  it('updatedAt strictly increases after a PATCH (1.1s apart)', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Track updatedAt',
    });
    const taskId = created.json().id as number;
    const before = created.json().updatedAt as string;

    // sqlite datetime('now') is second-granular; wait >1s to guarantee a tick.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(ivan.accessToken),
      payload: { title: 'Touched' },
    });
    expect(patched.statusCode).toBe(200);
    const after = patched.json().updatedAt as string;
    expect(after > before).toBe(true);
  });

  it('orders open-with-earlier-deadline first, no-deadline opens next, done last', async () => {
    // Fresh creator so the visible set is predictable for this assertion.
    const later = await createTask(sergey.accessToken, {
      title: 'order-later',
      deadline: '2026-12-31',
    });
    const earlier = await createTask(sergey.accessToken, {
      title: 'order-earlier',
      deadline: '2026-06-20',
    });
    const none = await createTask(sergey.accessToken, {
      title: 'order-none',
    });
    const doneTask = await createTask(sergey.accessToken, {
      title: 'order-done',
      deadline: '2026-01-01',
    });
    const doneId = doneTask.json().id as number;
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${doneId}`,
      headers: authHeader(sergey.accessToken),
      payload: { status: 'done' },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: authHeader(sergey.accessToken),
    });
    const order = (listed.json() as Array<{ id: number }>).map((t) => t.id);

    const iEarlier = order.indexOf(earlier.json().id as number);
    const iLater = order.indexOf(later.json().id as number);
    const iNone = order.indexOf(none.json().id as number);
    const iDone = order.indexOf(doneId);

    // earlier deadline before later deadline
    expect(iEarlier).toBeLessThan(iLater);
    // both dated opens before the no-deadline open
    expect(iLater).toBeLessThan(iNone);
    // every open before the done task
    expect(iNone).toBeLessThan(iDone);
  });

  it('admin POST without assigneeId creates an everyone-task (assigneeId null)', async () => {
    const res = await createTask(admin.accessToken, {
      title: 'Admin no-assignee everyone task',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().assigneeId).toBeNull();
  });

  it('GET /api/nonexistent -> 404 with JSON content-type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/nonexistent',
      headers: authHeader(admin.accessToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
