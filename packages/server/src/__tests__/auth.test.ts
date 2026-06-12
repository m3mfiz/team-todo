import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, login, nextTestIp } from './setup.ts';

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

  it('kills the entire token family when a revoked token is reused', async () => {
    // Two independent logins -> two distinct refresh tokens A and B.
    const sessionA = await login(app, 'olga', 'olga123');
    const sessionB = await login(app, 'olga', 'olga123');
    const tokenA = sessionA.refreshToken;
    const tokenB = sessionB.refreshToken;
    expect(tokenA).not.toBe(tokenB);

    // Rotate A -> A revoked, A2 issued.
    const rotA = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: tokenA },
    });
    expect(rotA.statusCode).toBe(200);
    const tokenA2 = rotA.json().refreshToken as string;

    // Reuse of the now-revoked A -> 401 and triggers family revocation.
    const reuseA = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: tokenA },
    });
    expect(reuseA.statusCode).toBe(401);

    // The whole family is dead: B and A2 are both rejected afterwards.
    const useB = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: tokenB },
    });
    expect(useB.statusCode).toBe(401);

    const useA2 = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: tokenA2 },
    });
    expect(useA2.statusCode).toBe(401);
  });

  it('rejects a garbage refresh token string with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an access token at the refresh endpoint with 401 (proves secret separation)', async () => {
    const { accessToken } = await login(app, 'sergey', 'sergey123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: accessToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects login of a nonexistent user with 401 (not 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': nextTestIp() },
      payload: { username: 'ghost', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits to 5 logins/min per ip: 6th wrong-password attempt -> 429', async () => {
    const ip = nextTestIp();
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: { username: 'admin', password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    }
    const sixth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': ip },
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(sixth.statusCode).toBe(429);
  });
});
