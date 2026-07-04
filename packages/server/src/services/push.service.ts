import webpush from 'web-push';
import { config } from '../config.ts';
import type { DB } from '../db/index.ts';

export type PushPayload = { title: string; body?: string; url?: string };

export type PushKind = 'new' | 'd7' | 'd3' | 'd1';

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

// Runtime flag: push is only enabled once setVapidDetails succeeds with a valid
// key pair. When disabled, every push operation is a silent no-op.
let pushEnabled = false;

// Logger threaded in via initPush (Fastify's app.log in production).
let pushLog: PushLogger = console;

export function isPushEnabled(): boolean {
  return pushEnabled;
}

export function getVapidPublicKey(): string | null {
  return config.vapidPublicKey ?? null;
}

// Idempotent: safe to call once at startup. Invalid/missing keys never throw —
// they simply leave push disabled. A single log line records the decision.
export function initPush(log: PushLogger = console): void {
  pushLog = log;
  if (
    config.vapidPublicKey === undefined ||
    config.vapidPrivateKey === undefined ||
    config.vapidSubject === undefined
  ) {
    pushEnabled = false;
    log.info('Web push disabled: VAPID keys not configured');
    return;
  }
  try {
    webpush.setVapidDetails(
      config.vapidSubject,
      config.vapidPublicKey,
      config.vapidPrivateKey,
    );
    pushEnabled = true;
    log.info('Web push enabled');
  } catch (err) {
    pushEnabled = false;
    log.warn(
      `Web push disabled: invalid VAPID configuration (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}

function getSubscriptions(db: DB, userId: number): SubscriptionRow[] {
  return db
    .prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    )
    .all(userId) as SubscriptionRow[];
}

function deleteSubscription(db: DB, id: number): void {
  db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

export async function sendToUser(
  db: DB,
  userId: number,
  payload: PushPayload,
): Promise<void> {
  if (!pushEnabled) {
    return;
  }
  const subscriptions = getSubscriptions(db, userId);
  const body = JSON.stringify(payload);
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
    } catch (err) {
      const statusCode =
        typeof (err as { statusCode?: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : undefined;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription is gone for good: drop the stale row.
        deleteSubscription(db, sub.id);
      } else {
        pushLog.warn(
          `Web push send failed (user ${userId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}

// Claim-then-send dedupe: INSERT OR IGNORE returns changes=1 only when this is
// the first claim for (task, user, kind). The caller sends only when true.
export function markSent(
  db: DB,
  taskId: number,
  userId: number,
  kind: PushKind,
): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO push_sent_log (task_id, user_id, kind)
       VALUES (?, ?, ?)`,
    )
    .run(taskId, userId, kind);
  return info.changes > 0;
}

export function wasSent(
  db: DB,
  taskId: number,
  userId: number,
  kind: PushKind,
): boolean {
  const row = db
    .prepare(
      'SELECT 1 FROM push_sent_log WHERE task_id = ? AND user_id = ? AND kind = ?',
    )
    .get(taskId, userId, kind);
  return row !== undefined;
}
