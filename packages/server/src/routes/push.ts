import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { AppError } from '../utils/errors.ts';
import { getVapidPublicKey } from '../services/push.service.ts';

const subscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1),
});

interface SubscriptionOwnerRow {
  user_id: number;
}

export function registerPushRoutes(app: FastifyInstance, db: DB): void {
  app.get(
    '/api/push/vapid-public-key',
    { preHandler: app.authenticate },
    async () => {
      return { publicKey: getVapidPublicKey() };
    },
  );

  app.post(
    '/api/push/subscribe',
    { preHandler: app.authenticate },
    async (request) => {
      const body = subscribeSchema.parse(request.body);
      const userId = request.user.id;

      const existing = db
        .prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?')
        .get(body.endpoint) as SubscriptionOwnerRow | undefined;

      if (existing && existing.user_id !== userId) {
        throw AppError.conflict('Endpoint already registered to another user');
      }

      // Upsert so a concurrent duplicate subscribe by the same user is
      // idempotent instead of hitting UNIQUE(endpoint).
      db.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth`,
      ).run(userId, body.endpoint, body.keys.p256dh, body.keys.auth);

      return { ok: true };
    },
  );

  app.post(
    '/api/push/unsubscribe',
    { preHandler: app.authenticate },
    async (request) => {
      const body = unsubscribeSchema.parse(request.body);
      // Delete only the caller's row; missing rows are a no-op.
      db.prepare(
        'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
      ).run(body.endpoint, request.user.id);
      return { ok: true };
    },
  );
}
