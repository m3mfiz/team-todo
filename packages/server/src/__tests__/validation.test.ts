import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, type LoginResult } from './setup.ts';

let app: FastifyInstance;
let dbPath: string;
let admin: LoginResult;
let ivan: LoginResult;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
  admin = await login(app, 'admin', 'admin123');
  ivan = await login(app, 'ivan', 'ivan123');
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

function createTask(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: authHeader(token),
    payload: body,
  });
}

describe('validation: task create deadline', () => {
  it.each([
    ['2026-13-45', 400],
    ['abc', 400],
    ['2026-1-1', 400],
    ['2026-02-30', 400],
    ['2026-12-31', 201],
  ])('deadline %s -> %d', async (deadline, expected) => {
    const res = await createTask(admin.accessToken, {
      title: 'Deadline check',
      deadline,
    });
    expect(res.statusCode).toBe(expected);
  });
});

describe('validation: task create title/notes bounds', () => {
  it('empty title -> 400', async () => {
    const res = await createTask(admin.accessToken, { title: '' });
    expect(res.statusCode).toBe(400);
  });

  it('title of 301 chars -> 400', async () => {
    const res = await createTask(admin.accessToken, { title: 'a'.repeat(301) });
    expect(res.statusCode).toBe(400);
  });

  it('title of exactly 300 chars -> 201', async () => {
    const res = await createTask(admin.accessToken, { title: 'a'.repeat(300) });
    expect(res.statusCode).toBe(201);
  });

  it('notes of 5001 chars -> 400', async () => {
    const res = await createTask(admin.accessToken, {
      title: 'Notes too long',
      notes: 'a'.repeat(5001),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('validation: task patch body', () => {
  async function makeTask(): Promise<number> {
    const res = await createTask(admin.accessToken, {
      title: 'Patch target',
      assigneeId: ivan.user.id,
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as number;
  }

  it('unknown field {foo:1} -> 400 (strict schema)', async () => {
    const id = await makeTask();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      headers: authHeader(admin.accessToken),
      payload: { foo: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('empty body {} -> 400 (no fields to update)', async () => {
    const id = await makeTask();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      headers: authHeader(admin.accessToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/at least one field/i);
  });

  // Body-shape validation is uniform across ids: an empty body gets the same
  // 400 whether the task is visible, invisible, or nonexistent (it is checked
  // at the zod layer, like unknown fields), so the response never reveals
  // resource existence.
  it('empty body {} -> 400 uniformly: invisible task and nonexistent id', async () => {
    const adminTask = await createTask(admin.accessToken, {
      title: 'Invisible to ivan-as-prober',
      assigneeId: admin.user.id,
    });
    const invisibleId = adminTask.json().id as number;

    const onInvisible = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${invisibleId}`,
      headers: authHeader(ivan.accessToken),
      payload: {},
    });
    expect(onInvisible.statusCode).toBe(400);

    const onNonexistent = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/999999',
      headers: authHeader(ivan.accessToken),
      payload: {},
    });
    expect(onNonexistent.statusCode).toBe(400);
    // identical bodies — no existence signal
    expect(onInvisible.json().message).toBe(onNonexistent.json().message);
  });

  // Non-429 framework 4xx errors must keep their status but expose only a
  // generic message, never plugin internals.
  it('malformed JSON body -> 400 with generic message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        ...authHeader(admin.accessToken),
        'content-type': 'application/json',
      },
      payload: '{broken json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Bad Request');
  });

  it('status closed -> 400 (enum is open|done)', async () => {
    const id = await makeTask();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      headers: authHeader(admin.accessToken),
      payload: { status: 'closed' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('validation: task id param', () => {
  // Only PATCH and DELETE register an /api/tasks/:id route, so those parse the
  // id param. There is no GET /api/tasks/:id route by design (the list endpoint
  // is GET /api/tasks), hence a GET to /api/tasks/abc is a genuine 404, asserted
  // separately below rather than as an id-validation case.
  it.each(['PATCH', 'DELETE'] as const)(
    '%s /api/tasks/abc -> 400 (non-numeric id)',
    async (method) => {
      const res = await app.inject({
        method,
        url: '/api/tasks/abc',
        headers: authHeader(admin.accessToken),
        payload: method === 'PATCH' ? { status: 'done' } : undefined,
      });
      expect(res.statusCode).toBe(400);
    },
  );

  it('GET /api/tasks/abc -> 404 (no by-id GET route exists)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks/abc',
      headers: authHeader(admin.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH nonexistent numeric id -> 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/999999',
      headers: authHeader(admin.accessToken),
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE nonexistent numeric id -> 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/999999',
      headers: authHeader(admin.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('validation: admin assignee existence', () => {
  it('admin POST assigneeId 99999 -> 400', async () => {
    const res = await createTask(admin.accessToken, {
      title: 'Bad assignee',
      assigneeId: 99999,
    });
    expect(res.statusCode).toBe(400);
  });
});
