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

// Web-push VAPID keys are optional: when both keys are present push is enabled,
// otherwise every push path becomes a silent no-op. A missing/blank subject
// defaults to a placeholder so a present key pair still configures correctly.
const rawVapidPublic = process.env.VAPID_PUBLIC_KEY;
const rawVapidPrivate = process.env.VAPID_PRIVATE_KEY;
const rawVapidSubject = process.env.VAPID_SUBJECT;
const hasVapidKeys =
  rawVapidPublic !== undefined &&
  rawVapidPublic !== '' &&
  rawVapidPrivate !== undefined &&
  rawVapidPrivate !== '';
const vapidPublicKey = hasVapidKeys ? rawVapidPublic : undefined;
const vapidPrivateKey = hasVapidKeys ? rawVapidPrivate : undefined;
const vapidSubject = hasVapidKeys
  ? rawVapidSubject !== undefined && rawVapidSubject !== ''
    ? rawVapidSubject
    : 'mailto:admin@ask4k.live'
  : undefined;

// DB_PATH default is relative to the repo root.
const repoRoot = new URL('../../../', import.meta.url);
const rawDbPath = process.env.DB_PATH ?? './data/team-todo.db';
const dbPath = rawDbPath.startsWith('/')
  ? rawDbPath
  : new URL(rawDbPath, repoRoot).pathname;

// A forgotten ADMIN_PASSWORD must never silently seed a default.
const adminPassword = required('ADMIN_PASSWORD');

export const config = {
  port: Number(process.env.PORT ?? 3002),
  jwtSecret,
  jwtRefreshSecret,
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword,
  dbPath,
  tz: process.env.TZ ?? 'UTC',
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject,
} as const;

export type Config = typeof config;
