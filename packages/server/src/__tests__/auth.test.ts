import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login } from './setup.ts';

let app: FastifyInstance;
let dbPath: string;

beforeAll(async () => {
  const ctx = await buildTestApp();
  app = ctx.app;
  dbPath = ctx.dbPath;
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

describe('auth', () => {
  it('logs in with valid credentials and returns tokens + user', async () => {
    const result = await login(app, 'admin', 'admin123');
    expect(result.accessToken).toBeTypeOf('string');
    expect(result.refreshToken).toBeTypeOf('string');
    expect(result.user.username).toBe('admin');
    expect(result.user.role).toBe('admin');
  });

  it('rejects wrong password with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns current user with valid token via /api/auth/me', async () => {
    const { accessToken } = await login(app, 'ivan', 'ivan123');
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader(accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('ivan');
  });

  it('rejects /api/auth/me without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rotates refresh tokens and invalidates the old one', async () => {
    const { refreshToken } = await login(app, 'maria', 'maria123');

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const newRefresh = first.json().refreshToken as string;
    expect(newRefresh).not.toBe(refreshToken);

    // Reusing the old (now revoked) token must fail.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('revokes refresh token on logout', async () => {
    const { refreshToken } = await login(app, 'sergey', 'sergey123');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
