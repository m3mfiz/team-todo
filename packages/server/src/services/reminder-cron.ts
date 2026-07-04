import cron from 'node-cron';
import type { DB } from '../db/index.ts';
import { runDeadlineReminders } from './notify.service.ts';

// Module-level guard so the daily cron is scheduled at most once per process
// even if buildApp is invoked more than once.
let started = false;

interface CronLogger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

// Deletes rows that can never matter again: refresh tokens past their expiry
// (revoked-but-unexpired rows are kept — reuse detection must still find them)
// and push-dedupe log rows for tasks completed more than 90 days ago.
// datetime() normalizes both stored formats (ISO with T/Z and SQLite's
// 'YYYY-MM-DD HH:MM:SS') to comparable UTC strings.
export function runDailyGc(db: DB): void {
  db.prepare(
    "DELETE FROM refresh_tokens WHERE datetime(expires_at) < datetime('now')",
  ).run();
  db.prepare(
    `DELETE FROM push_sent_log WHERE task_id IN (
       SELECT id FROM tasks
       WHERE status = 'done'
         AND completed_at IS NOT NULL
         AND datetime(completed_at) < datetime('now', '-90 days')
     )`,
  ).run();
}

// Schedules the deadline-reminder sweep at 09:00 process-local time. Idempotent.
export function startReminderCron(db: DB, log: CronLogger): void {
  if (started) {
    return;
  }
  started = true;
  cron.schedule('0 9 * * *', () => {
    runDeadlineReminders(db).catch((err) => {
      log.error(err, 'deadline reminder sweep failed');
    });
    try {
      runDailyGc(db);
    } catch (err) {
      log.error(err, 'daily gc failed');
    }
  });
  log.info('Deadline reminder cron scheduled (0 9 * * *)');
  // Catch-up: a process (re)started after 09:00 would otherwise skip today's
  // sweep entirely. The push_sent_log claim makes re-running safe.
  if (new Date().getHours() >= 9) {
    runDeadlineReminders(db).catch((err) => {
      log.error(err, 'startup reminder catch-up failed');
    });
  }
}
