import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, type LoginResult } from './setup.ts';
import type { DB } from '../db/index.ts';

let app: FastifyInstance;
let db: DB;
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
  db = (app as FastifyInstance & { db: DB }).db;
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

interface TaskJson {
  id: number;
  status: 'open' | 'done';
  assigneeId: number | null;
  completions?: Array<{ userId: number }>;
  myCompleted?: boolean;
}

async function createEveryoneTask(title: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: authHeader(admin.accessToken),
    payload: { title, assigneeId: null },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as TaskJson).id;
}

async function patchTask(
  token: string,
  taskId: number,
  payload: Record<string, unknown>,
): Promise<TaskJson> {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${taskId}`,
    headers: authHeader(token),
    payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as TaskJson;
}

function completionCount(taskId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM task_completions WHERE task_id = ?')
    .get(taskId) as { n: number };
  return row.n;
}

describe('assignee changes vs per-member completions', () => {
  it('title edit with an unchanged assigneeId: null keeps completions', async () => {
    const taskId = await createEveryoneTask('Reassign A');
    await patchTask(ivan.accessToken, taskId, { status: 'done' });
    await patchTask(maria.accessToken, taskId, { status: 'done' });
    expect(completionCount(taskId)).toBe(2);

    // The client always re-sends assigneeId on admin edits.
    const updated = await patchTask(admin.accessToken, taskId, {
      title: 'Reassign A (renamed)',
      assigneeId: null,
    });
    expect(updated.status).toBe('open');
    expect((updated.completions ?? []).map((c) => c.userId).sort()).toEqual(
      [ivan.user.id, maria.user.id].sort(),
    );
    expect(completionCount(taskId)).toBe(2);
  });

  it('reassigning everyone → member clears marks; back to null cannot flip done from stale marks', async () => {
    const taskId = await createEveryoneTask('Reassign B');
    await patchTask(ivan.accessToken, taskId, { status: 'done' });
    await patchTask(maria.accessToken, taskId, { status: 'done' });
    expect(completionCount(taskId)).toBe(2);

    const assigned = await patchTask(admin.accessToken, taskId, {
      assigneeId: ivan.user.id,
    });
    expect(assigned.assigneeId).toBe(ivan.user.id);
    expect(assigned.completions).toBeUndefined();
    expect(completionCount(taskId)).toBe(0);

    const backToEveryone = await patchTask(admin.accessToken, taskId, {
      assigneeId: null,
    });
    expect(backToEveryone.completions).toEqual([]);
    expect(backToEveryone.myCompleted).toBe(false);

    // Only sergey and olga mark now; without ivan's and maria's stale marks
    // the task must stay open.
    await patchTask(sergey.accessToken, taskId, { status: 'done' });
    const partial = await patchTask(olga.accessToken, taskId, {
      status: 'done',
    });
    expect(partial.status).toBe('open');
    expect((partial.completions ?? []).map((c) => c.userId).sort()).toEqual(
      [sergey.user.id, olga.user.id].sort(),
    );
  });

  it('reassigning between two specific members also clears', async () => {
    const taskId = await createEveryoneTask('Reassign C');
    await patchTask(admin.accessToken, taskId, { assigneeId: ivan.user.id });
    // Simulate a stale mark surviving from an earlier everyone phase.
    db.prepare(
      `INSERT INTO task_completions (task_id, user_id) VALUES (?, ?)`,
    ).run(taskId, maria.user.id);
    expect(completionCount(taskId)).toBe(1);

    const moved = await patchTask(admin.accessToken, taskId, {
      assigneeId: maria.user.id,
    });
    expect(moved.assigneeId).toBe(maria.user.id);
    expect(completionCount(taskId)).toBe(0);

    // Re-sending the same specific assignee does not touch anything.
    db.prepare(
      `INSERT INTO task_completions (task_id, user_id) VALUES (?, ?)`,
    ).run(taskId, ivan.user.id);
    await patchTask(admin.accessToken, taskId, {
      title: 'Reassign C (renamed)',
      assigneeId: maria.user.id,
    });
    expect(completionCount(taskId)).toBe(1);
  });
});
