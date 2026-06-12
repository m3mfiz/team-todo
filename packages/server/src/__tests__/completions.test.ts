import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, type LoginResult } from './setup.ts';

// Per-member completion of everyone-tasks (assignee_id IS NULL).
// Seed provides 4 members: ivan, maria, sergey, olga.
//
// The tests in this file are order-dependent by design: the member roster
// changes mid-file (olga is soft-deleted, petr is added later) to exercise
// the sweep and the "new member owes open tasks" semantics.

let app: FastifyInstance;
let dbPath: string;
let admin: LoginResult;
let ivan: LoginResult;
let maria: LoginResult;
let sergey: LoginResult;
let olga: LoginResult;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  admin = await login(app, 'admin', 'admin123');
  ivan = await login(app, 'ivan', 'ivan123');
  maria = await login(app, 'maria', 'maria123');
  sergey = await login(app, 'sergey', 'sergey123');
  olga = await login(app, 'olga', 'olga123');
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

interface CompletionJson {
  userId: number;
  displayName: string;
  completedAt: string;
}

interface TaskJson {
  id: number;
  status: 'open' | 'done';
  completedAt: string | null;
  completions?: CompletionJson[];
  myCompleted?: boolean;
}

async function createTask(token: string, body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: authHeader(token),
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as TaskJson;
}

async function patchStatus(
  token: string,
  taskId: number,
  status: 'open' | 'done',
) {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers: authHeader(token),
    payload: { status },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as TaskJson;
}

async function getTask(token: string, taskId: number): Promise<TaskJson> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: authHeader(token),
  });
  expect(res.statusCode).toBe(200);
  const task = (res.json() as TaskJson[]).find((t) => t.id === taskId);
  expect(task).toBeDefined();
  return task as TaskJson;
}

function userIds(completions: CompletionJson[] | undefined): number[] {
  return (completions ?? []).map((c) => c.userId);
}

describe('everyone-task per-member completions', () => {
  // Shared everyone-task used by the first block of tests.
  let taskA: number;

  it('member done -> myCompleted true, global stays open; other member myCompleted false', async () => {
    const created = await createTask(admin.accessToken, {
      title: 'Everyone task A',
      assigneeId: null,
    });
    taskA = created.id;
    // Fresh everyone-task carries the fields with empty/false values.
    expect(created.completions).toEqual([]);
    expect(created.myCompleted).toBe(false);

    const done = await patchStatus(ivan.accessToken, taskA, 'done');
    expect(done.status).toBe('open');
    expect(done.completedAt).toBeNull();
    expect(done.myCompleted).toBe(true);
    expect(userIds(done.completions)).toEqual([ivan.user.id]);
    expect(done.completions?.[0].completedAt).toBeTruthy();

    const forMaria = await getTask(maria.accessToken, taskA);
    expect(forMaria.myCompleted).toBe(false);
    expect(forMaria.status).toBe('open');
  });

  it('completions are visible in GET for admin and member; personal tasks have no completions', async () => {
    const forAdmin = await getTask(admin.accessToken, taskA);
    expect(userIds(forAdmin.completions)).toEqual([ivan.user.id]);
    expect(forAdmin.completions?.[0].displayName).toBe('Иван');
    // The admin has no personal mark.
    expect(forAdmin.myCompleted).toBe(false);

    const forSergey = await getTask(sergey.accessToken, taskA);
    expect(userIds(forSergey.completions)).toEqual([ivan.user.id]);
    expect(forSergey.myCompleted).toBe(false);

    const personal = await createTask(admin.accessToken, {
      title: 'Personal for ivan',
      assigneeId: ivan.user.id,
    });
    expect(personal.completions).toBeUndefined();
    expect(personal.myCompleted).toBeUndefined();
    const listed = await getTask(ivan.accessToken, personal.id);
    expect(listed.completions).toBeUndefined();
    expect(listed.myCompleted).toBeUndefined();
  });

  it('all 4 members marked -> global done with completedAt; completions sorted by displayName', async () => {
    await patchStatus(maria.accessToken, taskA, 'done');
    await patchStatus(sergey.accessToken, taskA, 'done');
    const last = await patchStatus(olga.accessToken, taskA, 'done');

    expect(last.status).toBe('done');
    expect(last.completedAt).not.toBeNull();
    expect(last.myCompleted).toBe(true);
    expect(last.completions).toHaveLength(4);
    expect(last.completions?.map((c) => c.displayName)).toEqual([
      'Иван',
      'Мария',
      'Ольга',
      'Сергей',
    ]);
  });

  it('un-complete by one member deletes his mark and reopens globally', async () => {
    const reopened = await patchStatus(maria.accessToken, taskA, 'open');
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
    expect(reopened.myCompleted).toBe(false);
    expect(userIds(reopened.completions)).not.toContain(maria.user.id);
    expect(reopened.completions).toHaveLength(3);
  });

  it('admin force-done completes globally without touching marks', async () => {
    const forced = await patchStatus(admin.accessToken, taskA, 'done');
    expect(forced.status).toBe('done');
    expect(forced.completedAt).not.toBeNull();
    // maria's mark was NOT re-created by the admin's force-complete.
    expect(forced.completions).toHaveLength(3);
    expect(userIds(forced.completions)).not.toContain(maria.user.id);
  });

  it("member 'open' after admin force reopens globally and removes his mark", async () => {
    const reopened = await patchStatus(sergey.accessToken, taskA, 'open');
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
    expect(reopened.myCompleted).toBe(false);
    // ivan + olga remain.
    expect(userIds(reopened.completions)).toEqual([
      ivan.user.id,
      olga.user.id,
    ]);
  });

  it('personal task regression: done/reopen as before, no completion fields', async () => {
    const created = await createTask(ivan.accessToken, {
      title: 'Ivan personal regression',
    });
    expect(created.completions).toBeUndefined();
    expect(created.myCompleted).toBeUndefined();

    const done = await patchStatus(ivan.accessToken, created.id, 'done');
    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();
    expect(done.completions).toBeUndefined();
    expect(done.myCompleted).toBeUndefined();

    const reopened = await patchStatus(ivan.accessToken, created.id, 'open');
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
    expect(reopened.completions).toBeUndefined();
  });

  // From here on the member roster changes: olga is soft-deleted.
  let taskC: number;

  it('sweep: 3 of 4 marked, soft-deleting the 4th flips the task to done', async () => {
    const created = await createTask(admin.accessToken, {
      title: 'Everyone task C (sweep)',
      assigneeId: null,
    });
    taskC = created.id;

    await patchStatus(ivan.accessToken, taskC, 'done');
    await patchStatus(maria.accessToken, taskC, 'done');
    const third = await patchStatus(sergey.accessToken, taskC, 'done');
    // olga has not marked it: still open.
    expect(third.status).toBe('open');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${olga.user.id}`,
      headers: authHeader(admin.accessToken),
    });
    expect(del.statusCode).toBe(200);

    const afterSweep = await getTask(admin.accessToken, taskC);
    expect(afterSweep.status).toBe('done');
    expect(afterSweep.completedAt).not.toBeNull();
    expect(userIds(afterSweep.completions)).toEqual([
      ivan.user.id,
      maria.user.id,
      sergey.user.id,
    ]);

    // Task A only had marks from ivan + olga; with maria and sergey still
    // missing, the sweep must NOT flip it. olga's mark is now invisible
    // (rows survive the soft-delete but only live members are listed).
    const stillOpen = await getTask(admin.accessToken, taskA);
    expect(stillOpen.status).toBe('open');
    expect(userIds(stillOpen.completions)).toEqual([ivan.user.id]);
  });

  it('adding a member later: done tasks stay done; open tasks flip only when the new member marks', async () => {
    // Live members now: ivan, maria, sergey. Add petr.
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: authHeader(admin.accessToken),
      payload: { username: 'petr', displayName: 'Пётр', password: 'petr123' },
    });
    expect(created.statusCode).toBe(201);
    const petr = await login(app, 'petr', 'petr123');

    // Contract: the flip happens only at mark-time or in the sweep; a task
    // already done (taskC, completed by 3/3 before petr existed) is never
    // reopened by adding people.
    const stillDone = await getTask(admin.accessToken, taskC);
    expect(stillDone.status).toBe('done');

    // A new everyone-task now requires petr too.
    const taskD = (
      await createTask(admin.accessToken, {
        title: 'Everyone task D (new member owes it)',
        assigneeId: null,
      })
    ).id;

    await patchStatus(ivan.accessToken, taskD, 'done');
    await patchStatus(maria.accessToken, taskD, 'done');
    const third = await patchStatus(sergey.accessToken, taskD, 'done');
    expect(third.status).toBe('open'); // petr has not marked it

    const last = await patchStatus(petr.accessToken, taskD, 'done');
    expect(last.status).toBe('done');
    expect(last.completedAt).not.toBeNull();
    expect(last.completions).toHaveLength(4);
  });
});
