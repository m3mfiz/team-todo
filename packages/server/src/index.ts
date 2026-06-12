import 'dotenv/config';
import { existsSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { createDb, migrate, type DB } from './db/index.ts';
import { AppError } from './utils/errors.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerUserRoutes } from './routes/users.ts';
import { registerTaskRoutes } from './routes/tasks.ts';
import { registerPushRoutes } from './routes/push.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { initPush } from './services/push.service.ts';
import { startReminderCron } from './services/reminder-cron.ts';

const ALLOWED_ORIGINS = ['http://localhost:5173'];

export interface BuildAppOptions {
  dbPath?: string;
}

export async function buildApp(
  opts: BuildAppOptions = {},
): Promise<FastifyInstance & { db: DB }> {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'password', 'refreshToken'],
    },
    trustProxy: 'loopback',
  });

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Same-origin / non-browser requests have no Origin header.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  });

  await app.register(fastifyRateLimit, { global: false });

  const dbPath = opts.dbPath ?? config.dbPath;
  const db = createDb(dbPath);
  migrate(db);
  app.decorate('db', db);

  app.addHook('onClose', async () => {
    db.close();
  });

  registerAuth(app, db);
  registerAuthRoutes(app, db);
  registerUserRoutes(app, db);
  registerTaskRoutes(app, db);
  registerPushRoutes(app, db);
  registerAdminRoutes(app, db);

  // Configure web push (silent no-op if VAPID keys are absent/invalid).
  initPush(app.log);

  // Schedule the daily deadline-reminder sweep — but never under test, where a
  // background cron would keep the process alive and fire real sends.
  if (process.env.VITEST !== 'true') {
    startReminderCron(db, app.log);
  }

  app.get('/api/health', async () => ({ ok: true }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: 'Bad Request',
        message: error.errors.map((e) => e.message).join('; '),
      });
      return;
    }
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        error: error.name,
        message: error.message,
      });
      return;
    }
    // Framework errors carry an HTTP statusCode (e.g. @fastify/rate-limit → 429).
    // Surface client errors (4xx) with the right status instead of masking them
    // as 500, but only forward the raw message for 429 (the rate-limiter's
    // retry hint is safe and useful); other framework 4xx get a generic text so
    // plugin internals are never exposed.
    if (
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      reply.code(error.statusCode).send({
        error: STATUS_CODES[error.statusCode] ?? 'Client Error',
        message:
          error.statusCode === 429
            ? error.message
            : STATUS_CODES[error.statusCode] ?? 'Request error',
      });
      return;
    }
    request.log.error(error);
    reply.code(500).send({ error: 'Internal Server Error' });
  });

  // Production static serving of the built client.
  const clientDist = new URL('../../client/dist', import.meta.url).pathname;
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        reply.sendFile('index.html');
        return;
      }
      reply.code(404).send({ error: 'Not Found' });
    });
  } else {
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app as FastifyInstance & { db: DB };
}

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  buildApp()
    .then((app) =>
      app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
        app.log.info(`Server listening on port ${config.port}`);
      }),
    )
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
