import { useEffect, useRef, useState, type JSX } from 'react';
import type { Task, UpdateTaskInput, User } from '../types';
import { formatDeadlineShort, isOverdue } from '../dates';
import { CheckMark, PieIcon, TrashIcon } from '../icons';
import { WhenSheet } from './WhenSheet';

const REOPEN_CONFIRM_MS = 2500;

interface TaskRowProps {
  task: Task;
  currentUser: User;
  members: User[];
  expanded: boolean;
  onToggleExpand: (id: number) => void;
  onComplete: (task: Task) => void; // open -> done (deferred removal handled by parent timing)
  onReopen: (task: Task) => void; // done -> open
  onSave: (id: number, input: UpdateTaskInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  // When set, this row is in its "leaving" animation window after completion.
  leaving?: boolean;
  // Active Quick Find query — highlights the matched substring in the title.
  highlightQuery?: string;
}

export function TaskRow({
  task,
  currentUser,
  members,
  expanded,
  onToggleExpand,
  onComplete,
  onReopen,
  onSave,
  onDelete,
  leaving,
  highlightQuery,
}: TaskRowProps): JSX.Element {
  const isAdmin = currentUser.role === 'admin';
  const isOwner = currentUser.id === task.creatorId;
  const canEdit = isAdmin || isOwner;
  const isDone = task.status === 'done';

  const checked = isDone || Boolean(leaving);

  // Reopening a done task requires a second confirming tap within a short
  // window — mirrors the existing delete-confirm pattern (protection against
  // an accidental un-complete, à la Things).
  const [confirmReopen, setConfirmReopen] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  function disarmReopen(): void {
    if (confirmTimerRef.current) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmReopen(false);
  }

  function handleCheckbox(e: React.MouseEvent): void {
    e.stopPropagation();
    if (isDone) {
      if (confirmReopen) {
        disarmReopen();
        onReopen(task);
      } else {
        setConfirmReopen(true);
        confirmTimerRef.current = window.setTimeout(disarmReopen, REOPEN_CONFIRM_MS);
      }
    } else if (!leaving) {
      onComplete(task);
    }
  }

  function handleBodyClick(): void {
    if (confirmReopen) disarmReopen();
    onToggleExpand(task.id);
  }

  // Meta line bits
  const showAssigneeMeta = isAdmin || !isOwner;
  const assigneeLabel = task.assigneeId === null ? null : task.assigneeName;
  const creatorLabel = !isOwner ? task.creatorName : null;

  // Shared-task progress: N marks of M living members. Capped at memberCount
  // so a transient roster/task poll lag can never render e.g. «3 из 2».
  const memberCount = members.filter((m) => m.role === 'member').length;
  const rawCompletionCount = task.completions?.length ?? 0;
  const completionCount =
    memberCount > 0 ? Math.min(rawCompletionCount, memberCount) : rawCompletionCount;

  return (
    <div className={`taskrow${expanded ? ' taskrow--expanded' : ''}${leaving ? ' taskrow--leaving' : ''}`}>
      <div className="taskrow__main">
        <button
          type="button"
          className={`checkbox${checked ? ' checkbox--checked' : ''}${confirmReopen ? ' checkbox--confirm' : ''}`}
          onClick={handleCheckbox}
          aria-pressed={checked}
          aria-label={isDone ? 'Вернуть в работу' : 'Отметить выполненной'}
        >
          <span className="checkbox__fill">
            <CheckMark size={15} />
          </span>
        </button>

        <button
          type="button"
          className="taskrow__body"
          onClick={handleBodyClick}
        >
          <span className="taskrow__title-row">
            <span className={`taskrow__title${checked ? ' taskrow__title--done' : ''}`}>
              {highlightMatch(task.title, highlightQuery)}
            </span>
            {confirmReopen && (
              <span className="taskrow__confirm-label">Вернуть?</span>
            )}
          </span>

          <span className="taskrow__meta">
            {task.notes && (
              <span className="taskrow__notes">{firstLine(task.notes)}</span>
            )}

            {task.deadline && !isDone && (
              <span
                className={`chip chip--date${isOverdue(task.deadline) ? ' chip--overdue' : ''}`}
              >
                {isOverdue(task.deadline)
                  ? `Просрочено · ${formatDeadlineShort(task.deadline)}`
                  : formatDeadlineShort(task.deadline)}
              </span>
            )}

            {task.assigneeId === null && memberCount > 0 && (
              <span className="chip chip--all chip--pie">
                <PieIcon fraction={completionCount / memberCount} />
                Всем · {completionCount} из {memberCount}
              </span>
            )}

            {task.assigneeId === null && memberCount === 0 && (
              <span className="chip chip--all">Всем</span>
            )}

            {showAssigneeMeta && assigneeLabel && task.assigneeId !== null && (
              <span className="taskrow__person">для {assigneeLabel}</span>
            )}

            {showAssigneeMeta && creatorLabel && (
              <span className="taskrow__person">от {creatorLabel}</span>
            )}
          </span>
        </button>
      </div>

      {expanded && (
        <TaskDetail
          task={task}
          isAdmin={isAdmin}
          canEdit={canEdit}
          members={members}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function firstLine(notes: string): string {
  const line = notes.split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

// Wraps the first case-insensitive match of `query` in <mark> for Quick Find.
function highlightMatch(text: string, query: string | undefined): JSX.Element {
  const q = query?.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// «Выполнение» — per-member marks on a shared task. Rows come from the
// members list (admin has it); completion entries of users missing from that
// list (e.g. a member viewer, whose members prop is empty) are merged in so
// the block stays informative for everyone — the data is open.
function CompletionList({
  task,
  members,
}: {
  task: Task;
  members: User[];
}): JSX.Element | null {
  if (task.assigneeId !== null) return null;
  const completions = task.completions ?? [];
  const byUser = new Map(completions.map((c) => [c.userId, c]));

  const rows = members
    .filter((m) => m.role === 'member')
    .map((m) => ({
      userId: m.id,
      displayName: m.displayName,
      completedAt: byUser.get(m.id)?.completedAt ?? null,
    }));
  const known = new Set(rows.map((r) => r.userId));
  for (const c of completions) {
    if (!known.has(c.userId)) {
      rows.push({
        userId: c.userId,
        displayName: c.displayName,
        completedAt: c.completedAt,
      });
    }
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));

  return (
    <div className="completion-list" aria-label="Выполнение">
      <span className="completion-list__label">Выполнение</span>
      {rows.map((r) => (
        <div className="completion-row" key={r.userId}>
          <span
            className={`completion-dot${r.completedAt ? ' completion-dot--done' : ''}`}
            aria-hidden="true"
          >
            {r.completedAt && <CheckMark size={11} />}
          </span>
          <span className="completion-row__name">{r.displayName}</span>
          {r.completedAt && (
            <span className="completion-row__date">
              {formatDeadlineShort(r.completedAt.slice(0, 10))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Which field is currently being edited
type ActiveField = 'title' | 'notes' | 'deadline' | 'assignee' | null;

interface TaskDetailProps {
  task: Task;
  isAdmin: boolean;
  canEdit: boolean;
  members: User[];
  onSave: (id: number, input: UpdateTaskInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

/**
 * Unified view+edit component.
 * Always opens in view mode. Tapping an interactive field activates it.
 * Save/Cancel appear as soon as any field is dirty.
 */
function TaskDetail({
  task,
  isAdmin,
  canEdit,
  members,
  onSave,
  onDelete,
}: TaskDetailProps): JSX.Element {
  // Draft values — only committed on Save
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftNotes, setDraftNotes] = useState(task.notes ?? '');
  const [draftDeadline, setDraftDeadline] = useState(task.deadline ?? '');
  const [draftAssignee, setDraftAssignee] = useState<string>(
    task.assigneeId === null ? 'all' : String(task.assigneeId),
  );

  const [activeField, setActiveField] = useState<ActiveField>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showWhenSheet, setShowWhenSheet] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLTextAreaElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Task the drafts were last seeded from — the baseline for "did the user edit".
  const baselineRef = useRef(task);

  // Re-sync drafts when a poll brings someone else's edit — but never clobber
  // an active or user-edited draft, or one mid-save.
  useEffect(() => {
    if (activeField !== null || saving) return;
    const base = baselineRef.current;
    const untouched =
      draftTitle === base.title &&
      draftNotes === (base.notes ?? '') &&
      draftDeadline === (base.deadline ?? '') &&
      draftAssignee === (base.assigneeId === null ? 'all' : String(base.assigneeId));
    if (!untouched) return;
    baselineRef.current = task;
    setDraftTitle(task.title);
    setDraftNotes(task.notes ?? '');
    setDraftDeadline(task.deadline ?? '');
    setDraftAssignee(task.assigneeId === null ? 'all' : String(task.assigneeId));
  }, [task.updatedAt, activeField, saving]);

  // Dirty check — any draft differs from original
  const isDirty =
    draftTitle.trim() !== task.title ||
    draftNotes.trim() !== (task.notes ?? '') ||
    draftDeadline !== (task.deadline ?? '') ||
    draftAssignee !== (task.assigneeId === null ? 'all' : String(task.assigneeId));

  function activateField(field: ActiveField, focusCb?: () => void): void {
    setActiveField(field);
    // Let the DOM update, then focus
    if (focusCb) {
      requestAnimationFrame(focusCb);
    }
  }

  function handleCancel(): void {
    // Reset all drafts to original values
    baselineRef.current = task;
    setDraftTitle(task.title);
    setDraftNotes(task.notes ?? '');
    setDraftDeadline(task.deadline ?? '');
    setDraftAssignee(task.assigneeId === null ? 'all' : String(task.assigneeId));
    setActiveField(null);
    setConfirmDelete(false);
    setSaveError(null);
  }

  async function handleSave(): Promise<void> {
    if (saving || !draftTitle.trim()) return;
    if (!isDirty) {
      // Nothing changed — never send a no-op PATCH; just leave edit mode.
      setActiveField(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const input: UpdateTaskInput = {
      title: draftTitle.trim(),
      notes: draftNotes.trim(),
    };
    if (isAdmin) {
      input.deadline = draftDeadline ? draftDeadline : null;
      input.assigneeId = draftAssignee === 'all' ? null : Number(draftAssignee);
    }
    try {
      await onSave(task.id, input);
      setActiveField(null);
    } catch {
      setSaveError('Не удалось сохранить — попробуйте ещё раз');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await onDelete(task.id);
    } finally {
      setSaving(false);
    }
  }

  // Deadline display value
  const deadlineDisplay = draftDeadline
    ? formatDeadlineShort(draftDeadline)
    : 'Нет';

  // Assignee display value
  const assigneeDisplay =
    draftAssignee === 'all'
      ? 'Всем'
      : (members.find((m) => String(m.id) === draftAssignee)?.displayName ??
        task.assigneeName ??
        'Всем');

  const showActions = isDirty || activeField !== null;

  return (
    <div className="editor editor--view">
      {/* ── Title row (duplicated inside expanded area for tap-to-edit) ── */}
      {canEdit ? (
        activeField === 'title' ? (
          <input
            ref={titleInputRef}
            autoFocus
            className="editor__title"
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Название"
          />
        ) : (
          <button
            type="button"
            className="editor__field-tap editor__title-view"
            onClick={() =>
              activateField('title', () => titleInputRef.current?.focus())
            }
            aria-label="Редактировать название"
          >
            {draftTitle || <span className="editor__placeholder">Название</span>}
          </button>
        )
      ) : null}

      {/* ── Notes ── */}
      {canEdit ? (
        activeField === 'notes' ? (
          <textarea
            ref={notesInputRef}
            autoFocus
            className="editor__notes"
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            placeholder="Заметки"
            rows={3}
          />
        ) : (
          <button
            type="button"
            className="editor__field-tap editor__notes-view"
            onClick={() =>
              activateField('notes', () => notesInputRef.current?.focus())
            }
            aria-label="Редактировать заметки"
          >
            {draftNotes ? (
              <span className="editor__notes-text">{draftNotes}</span>
            ) : (
              <span className="editor__placeholder">Добавить заметки…</span>
            )}
          </button>
        )
      ) : (
        task.notes && (
          <p className="editor__notes-ro">{task.notes}</p>
        )
      )}

      {/* ── Facts block ── */}
      <dl className="editor__facts">
        {/* Срок */}
        <div className="editor__fact">
          <dt>Срок</dt>
          <dd>
            {isAdmin && canEdit ? (
              <button
                type="button"
                className="editor__field-tap editor__fact-value"
                onClick={() => setShowWhenSheet(true)}
                aria-label="Редактировать срок"
              >
                {deadlineDisplay}
              </button>
            ) : (
              <span className="editor__fact-value">
                {task.deadline ? formatDeadlineShort(task.deadline) : 'Нет'}
              </span>
            )}
          </dd>
        </div>

        {/* Кому */}
        <div className="editor__fact">
          <dt>Кому</dt>
          <dd>
            {isAdmin && canEdit ? (
              activeField === 'assignee' ? (
                <select
                  ref={selectRef}
                  autoFocus
                  className="editor__select editor__select--inline"
                  value={draftAssignee}
                  onChange={(e) => {
                    setDraftAssignee(e.target.value);
                    setActiveField(null);
                  }}
                  onBlur={() => setActiveField(null)}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                  <option value="all">Всем</option>
                </select>
              ) : (
                <button
                  type="button"
                  className="editor__field-tap editor__fact-value"
                  onClick={() =>
                    activateField('assignee', () => selectRef.current?.focus())
                  }
                  aria-label="Редактировать исполнителя"
                >
                  {assigneeDisplay}
                </button>
              )
            ) : (
              <span className="editor__fact-value">
                {task.assigneeId === null ? 'Всем' : task.assigneeName}
              </span>
            )}
          </dd>
        </div>

        {/* От кого */}
        {task.creatorName ? (
          <div className="editor__fact">
            <dt>От кого</dt>
            <dd>
              <span className="editor__fact-value">{task.creatorName}</span>
            </dd>
          </div>
        ) : null}
      </dl>

      {/* ── Completion block for shared tasks ── */}
      <CompletionList task={task} members={members} />

      {/* ── Actions: trash + Save/Cancel ── */}
      {saveError && <div className="inline-error">{saveError}</div>}
      {(showActions || canEdit) && (
        <div className="editor__actions">
          {canEdit ? (
            <button
              type="button"
              className={`editor__trash${confirmDelete ? ' editor__trash--confirm' : ''}`}
              onClick={handleDelete}
              disabled={saving}
              aria-label="Удалить задачу"
            >
              <TrashIcon size={19} />
              {confirmDelete && (
                <span className="editor__trash-text">Удалить?</span>
              )}
            </button>
          ) : (
            <span />
          )}

          {showActions && (
            <div className="editor__actions-right">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleCancel}
                disabled={saving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleSave()}
                disabled={saving || !draftTitle.trim() || !isDirty}
              >
                Сохранить
              </button>
            </div>
          )}
        </div>
      )}

      {showWhenSheet && (
        <WhenSheet
          value={draftDeadline}
          onApply={(next) => {
            setDraftDeadline(next ?? '');
            setShowWhenSheet(false);
          }}
          onClose={() => setShowWhenSheet(false)}
        />
      )}
    </div>
  );
}
