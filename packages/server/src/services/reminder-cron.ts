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
  });
  log.info('Deadline reminder cron scheduled (0 9 * * *)');
}
