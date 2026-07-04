import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import type { CreateTaskInput, User } from '../types';
import { formatDeadlineShort } from '../dates';
import { WhenSheet } from './WhenSheet';

interface AddSheetProps {
  currentUser: User;
  members: User[];
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => Promise<void>;
}

export function AddSheet({
  currentUser,
  members,
  onClose,
  onCreate,
}: AddSheetProps): JSX.Element {
  const isAdmin = currentUser.role === 'admin';
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [deadline, setDeadline] = useState('');
  // Default: «Себе» -> currentUser.id
  const [assignee, setAssignee] = useState<string>(String(currentUser.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhen, setShowWhen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent): void {
      // While the nested WhenSheet is open, Escape must close only it —
      // its own listener (registered after this one re-subscribes) handles
      // that. Re-subscribing on showWhen keeps this closure's value fresh.
      if (e.key === 'Escape' && !showWhen) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showWhen]);

  async function submit(): Promise<void> {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError(null);
    const input: CreateTaskInput = { title: title.trim() };
    if (notes.trim()) input.notes = notes.trim();
    if (deadline) input.deadline = deadline;
    if (isAdmin) {
      input.assigneeId = assignee === 'all' ? null : Number(assignee);
    }
    try {
      await onCreate(input);
      onClose();
    } catch {
      setError('Не удалось сохранить — попробуйте ещё раз');
      setSaving(false);
    }
  }

  function onTitleKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onMouseDown={onClose}>
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Новая задача"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="sheet__grabber" />
          <input
            ref={titleRef}
            className="sheet__title"
            type="text"
            placeholder="Новая задача"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onTitleKey}
          />
          <textarea
            className="sheet__notes"
            placeholder="Заметки"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <div className="sheet__row">
            <div className="editor__control">
              <span className="editor__control-label">Срок</span>
              <button
                type="button"
                className="editor__date editor__date-btn"
                onClick={() => setShowWhen(true)}
              >
                {deadline ? formatDeadlineShort(deadline) : 'Нет'}
              </button>
            </div>
            {isAdmin && (
              <label className="editor__control">
                <span className="editor__control-label">Кому</span>
                <select
                  className="editor__select"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value={currentUser.id}>Себе</option>
                  {members
                    .filter((m) => m.id !== currentUser.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  <option value="all">Всем</option>
                </select>
              </label>
            )}
          </div>

          {error && <div className="inline-error">{error}</div>}

          <div className="sheet__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void submit()}
              disabled={saving || !title.trim()}
            >
              {saving ? 'Создание…' : 'Готово'}
            </button>
          </div>
        </div>
      </div>

      {showWhen && (
        <WhenSheet
          value={deadline}
          onApply={(next) => {
            setDeadline(next ?? '');
            setShowWhen(false);
          }}
          onClose={() => setShowWhen(false)}
          nested
        />
      )}
    </>
  );
}
