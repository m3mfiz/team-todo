import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Ensure JWT secrets exist before config.ts is imported (it validates at load).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'a'.repeat(64);
}
if (
  !process.env.JWT_REFRESH_SECRET ||
  process.env.JWT_REFRESH_SECRET.length < 32 ||
  process.env.JWT_REFRESH_SECRET === process.env.JWT_SECRET
) {
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
}
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123';

export interface TestContext {
  app: FastifyInstance;
  dbPath: string;
}

export async function buildTestApp(): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'team-todo-test-'));
  const dbPath = join(dir, `db-${randomBytes(6).toString('hex')}.sqlite`);
  process.env.DB_PATH = dbPath;

  // Import lazily so env overrides above are in effect.
  const { buildApp } = await import('../index.ts');
  const { seed } = await import('../db/seed.ts');

  const app = await buildApp({ dbPath });
  await app.ready();

  // Seed admin + members directly against the app's db.
  await seed((app as FastifyInstance & { db: import('../db/index.ts').DB }).db);

  return { app, dbPath };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: number; username: string; displayName: string; role: string };
}

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<LoginResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed (${res.statusCode}): ${res.body}`);
  }
  return res.json() as LoginResult;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
