import { useEffect, useRef, useState, type JSX } from 'react';
import type { Task, UpdateTaskInput, User } from '../types';
import { formatDeadlineShort, isOverdue } from '../dates';
import { CheckMark, TrashIcon } from '../icons';

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
}: TaskRowProps): JSX.Element {
  const isAdmin = currentUser.role === 'admin';
  const isOwner = currentUser.id === task.creatorId;
  const canEdit = isAdmin || isOwner;
  const isDone = task.status === 'done';

  const checked = isDone || Boolean(leaving);

  function handleCheckbox(e: React.MouseEvent): void {
    e.stopPropagation();
    if (isDone) {
      onReopen(task);
    } else if (!leaving) {
      onComplete(task);
    }
  }

  // Meta line bits
  const showAssigneeMeta = isAdmin || !isOwner;
  const assigneeLabel = task.assigneeId === null ? null : task.assigneeName;
  const creatorLabel = !isOwner ? task.creatorName : null;

  return (
    <div className={`taskrow${expanded ? ' taskrow--expanded' : ''}${leaving ? ' taskrow--leaving' : ''}`}>
      <div className="taskrow__main">
        <button
          type="button"
          className={`checkbox${checked ? ' checkbox--checked' : ''}`}
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
          onClick={() => onToggleExpand(task.id)}
        >
          <span className={`taskrow__title${checked ? ' taskrow__title--done' : ''}`}>
            {task.title}
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

            {task.assigneeId === null && (
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
        <TaskEditor
          task={task}
          isAdmin={isAdmin}
          canEdit={canEdit}
          members={members}
          onCancel={() => onToggleExpand(task.id)}
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

interface TaskEditorProps {
  task: Task;
  isAdmin: boolean;
  canEdit: boolean;
  members: User[];
  onCancel: () => void;
  onSave: (id: number, input: UpdateTaskInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function TaskEditor({
  task,
  isAdmin,
  canEdit,
  members,
  onCancel,
  onSave,
  onDelete,
}: TaskEditorProps): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [deadline, setDeadline] = useState(task.deadline ?? '');
  // 'all' sentinel maps to assigneeId === null
  const [assignee, setAssignee] = useState<string>(
    task.assigneeId === null ? 'all' : String(task.assigneeId),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (canEdit) titleRef.current?.focus();
  }, [canEdit]);

  async function handleSave(): Promise<void> {
    if (saving || !title.trim()) return;
    setSaving(true);
    const input: UpdateTaskInput = {
      title: title.trim(),
      notes: notes.trim() ? notes.trim() : null,
      deadline: deadline ? deadline : null,
    };
    if (isAdmin) {
      input.assigneeId = assignee === 'all' ? null : Number(assignee);
    }
    try {
      await onSave(task.id, input);
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

  if (!canEdit) {
    return (
      <div className="editor editor--readonly">
        {task.notes && <p className="editor__notes-ro">{task.notes}</p>}
        <dl className="editor__facts">
          {task.deadline && (
            <div className="editor__fact">
              <dt>Срок</dt>
              <dd>{formatDeadlineShort(task.deadline)}</dd>
            </div>
          )}
          <div className="editor__fact">
            <dt>Кому</dt>
            <dd>{task.assigneeId === null ? 'Всем' : task.assigneeName}</dd>
          </div>
          <div className="editor__fact">
            <dt>Автор</dt>
            <dd>{task.creatorName}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="editor">
      <input
        ref={titleRef}
        className="editor__title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Название"
      />
      <textarea
        className="editor__notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Заметки"
        rows={2}
      />
      <div className="editor__row">
        <label className="editor__control">
          <span className="editor__control-label">Срок</span>
          <input
            className="editor__date"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        {isAdmin && (
          <label className="editor__control">
            <span className="editor__control-label">Кому</span>
            <select
              className="editor__select"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
              <option value="all">Всем</option>
            </select>
          </label>
        )}
      </div>

      <div className="editor__actions">
        <button
          type="button"
          className={`editor__trash${confirmDelete ? ' editor__trash--confirm' : ''}`}
          onClick={handleDelete}
          disabled={saving}
          aria-label="Удалить задачу"
        >
          <TrashIcon size={19} />
          {confirmDelete && <span className="editor__trash-text">Удалить?</span>}
        </button>
        <div className="editor__actions-right">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
