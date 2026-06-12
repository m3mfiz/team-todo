import { config as loadDotenv } from 'dotenv';

// Load .env from repo root (this file lives at packages/server/src/config.ts,
// so the repo root is four levels up).
loadDotenv({ path: new URL('../../../.env', import.meta.url) });

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const jwtSecret = required('JWT_SECRET');
const jwtRefreshSecret = required('JWT_REFRESH_SECRET');

if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}
if (jwtRefreshSecret.length < 32) {
  throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
}
if (jwtSecret === jwtRefreshSecret) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
}

// DB_PATH default is relative to the repo root.
const repoRoot = new URL('../../../', import.meta.url);
const rawDbPath = process.env.DB_PATH ?? './data/team-todo.db';
const dbPath = rawDbPath.startsWith('/')
  ? rawDbPath
  : new URL(rawDbPath, repoRoot).pathname;

export const config = {
  port: Number(process.env.PORT ?? 3002),
  jwtSecret,
  jwtRefreshSecret,
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
  dbPath,
  tz: process.env.TZ ?? 'UTC',
} as const;

export type Config = typeof config;
