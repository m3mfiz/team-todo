import type { DB } from '../db/index.ts';
import {
  isPushEnabled,
  markSent,
  sendToUser,
  type PushKind,
  type PushPayload,
} from './push.service.ts';

type Sender = (db: DB, userId: number, payload: PushPayload) => Promise<void>;

// ---------------------------------------------------------------------------
// New-task notifications
// ---------------------------------------------------------------------------

interface NewTaskInput {
  id: number;
  title: string;
  deadline: string | null;
  assigneeId: number | null;
  creatorId: number;
}

// "Everyone" never includes soft-deleted users.
function allUserIds(db: DB): number[] {
  const rows = db
    .prepare('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id ASC')
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

// assigneeId null ("everyone") → every user except the creator; otherwise the
// single assignee, minus the creator (empty when self-assigned).
export function computeNewTaskRecipients(
  db: DB,
  task: { assigneeId: number | null; creatorId: number },
): number[] {
  if (task.assigneeId === null) {
    return allUserIds(db).filter((id) => id !== task.creatorId);
  }
  return task.assigneeId === task.creatorId ? [] : [task.assigneeId];
}

export async function notifyNewTask(
  db: DB,
  task: NewTaskInput,
  send: Sender = sendToUser,
): Promise<void> {
  // Do not claim sent-log rows while push is disabled: enabling VAPID keys
  // later must not find the notification already "sent".
  if (!isPushEnabled()) return;
  const recipients = computeNewTaskRecipients(db, {
    assigneeId: task.assigneeId,
    creatorId: task.creatorId,
  });
  const body = task.deadline
    ? `${task.title} · до ${task.deadline}`
    : task.title;
  const payload: PushPayload = { title: 'Новая задача', body, url: '/' };
  for (const userId of recipients) {
    if (markSent(db, task.id, userId, 'new')) {
      await send(db, userId, payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Deadline reminders
// ---------------------------------------------------------------------------

interface ReminderRow {
  id: number;
  title: string;
  deadline: string;
  assignee_id: number | null;
}

export interface DeadlineReminder {
  taskId: number;
  title: string;
  deadline: string;
  kind: Extract<PushKind, 'd7' | 'd3' | 'd1'>;
  recipientIds: number[];
}

// Adds `days` calendar days to a YYYY-MM-DD key (UTC math, date-only — safe
// because we only ever add whole days to a date with no time component).
function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computeDeadlineReminders(
  db: DB,
  todayKey: string,
): DeadlineReminder[] {
  const d7 = addDays(todayKey, 7);
  const d3 = addDays(todayKey, 3);
  const d1 = addDays(todayKey, 1);
  const kindByDate = new Map<string, DeadlineReminder['kind']>([
    [d7, 'd7'],
    [d3, 'd3'],
    [d1, 'd1'],
  ]);

  const rows = db
    .prepare(
      `SELECT id, title, deadline, assignee_id
       FROM tasks
       WHERE status = 'open' AND deadline IN (?, ?, ?)`,
    )
    .all(d7, d3, d1) as ReminderRow[];

  const everyone = allUserIds(db);

  return rows.map((row) => {
    const kind = kindByDate.get(row.deadline) as DeadlineReminder['kind'];
    const recipientIds =
      row.assignee_id === null ? everyone : [row.assignee_id];
    return {
      taskId: row.id,
      title: row.title,
      deadline: row.deadline,
      kind,
      recipientIds,
    };
  });
}

function reminderTitle(kind: DeadlineReminder['kind']): string {
  if (kind === 'd1') {
    return 'Завтра срок задачи';
  }
  if (kind === 'd3') {
    return 'Срок через 3 дня';
  }
  return 'Срок через 7 дней';
}

// Builds todayKey from `now` in the process-local timezone (Europe/Moscow in
// prod via the TZ env var), then fans reminders out to recipients, deduped by
// the sent-log so a re-run on the same day sends nothing new.
export async function runDeadlineReminders(
  db: DB,
  now: Date = new Date(),
  send: Sender = sendToUser,
): Promise<void> {
  if (!isPushEnabled()) return;
  const todayKey = localDayKey(now);
  const reminders = computeDeadlineReminders(db, todayKey);
  for (const reminder of reminders) {
    const payload: PushPayload = {
      title: reminderTitle(reminder.kind),
      body: reminder.title,
      url: '/',
    };
    for (const userId of reminder.recipientIds) {
      if (markSent(db, reminder.taskId, userId, reminder.kind)) {
        await send(db, userId, payload);
      }
    }
  }
}

// Local-timezone YYYY-MM-DD for the given instant. Uses en-CA which formats as
// ISO date, honouring the process TZ.
function localDayKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
