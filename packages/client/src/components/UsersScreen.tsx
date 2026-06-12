import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { api, ApiError } from '../api';
import type { User } from '../types';
import { TrashIcon } from '../icons';

const USERNAME_RE = /^[a-z][a-z0-9_]{2,29}$/;
const SAVED_NOTICE_MS = 3000;

interface UsersScreenProps {
  currentUser: User;
  users: User[];
  // refetch the users list (after create/delete)
  onUsersChanged: () => Promise<void>;
  // refetch tasks (after delete — admin sees assignments change)
  onTasksChanged: () => Promise<void>;
}

export function UsersScreen({
  currentUser,
  users,
  onUsersChanged,
  onTasksChanged,
}: UsersScreenProps): JSX.Element {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="users-screen">
      <div className="users-screen__list">
        {users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isSelf={u.id === currentUser.id}
            onDeleted={async () => {
              await onUsersChanged();
              await onTasksChanged();
            }}
          />
        ))}
      </div>

      {showAdd ? (
        <AddUserForm
          onCreated={onUsersChanged}
          onClose={() => setShowAdd(false)}
        />
      ) : (
        <button
          type="button"
          className="users-screen__add"
          onClick={() => setShowAdd(true)}
        >
          + Добавить сотрудника
        </button>
      )}
    </div>
  );
}

// --- Single user row ---------------------------------------------------------
interface UserRowProps {
  user: User;
  isSelf: boolean;
  onDeleted: () => Promise<void>;
}

function UserRow({ user, isSelf, onDeleted }: UserRowProps): JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  // member rows get the trash; the admin never deletes themself (server 400s anyway)
  const canDelete = user.role === 'member' && !isSelf;

  useEffect(() => {
    if (!passwordSaved) return;
    const id = window.setTimeout(() => setPasswordSaved(false), SAVED_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [passwordSaved]);

  async function handleDelete(): Promise<void> {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.adminDeleteUser(user.id);
      await onDeleted();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : 'Не удалось удалить сотрудника',
      );
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="user-row">
      <div className="user-row__main">
        <div className="user-row__info">
          <span className="user-row__name-line">
            <span className="user-row__name">{user.displayName}</span>
            {user.role === 'admin' && (
              <span className="chip chip--role">Админ</span>
            )}
          </span>
          <span className="user-row__login">@{user.username}</span>
        </div>

        <div className="user-row__actions">
          <button
            type="button"
            className="user-row__pass-btn"
            onClick={() => {
              setEditingPassword((v) => !v);
              setConfirmDelete(false);
            }}
          >
            Сменить пароль
          </button>

          {canDelete && (
            <button
              type="button"
              className={`user-row__trash${confirmDelete ? ' user-row__trash--confirm' : ''}`}
              onClick={() => void handleDelete()}
              disabled={deleting}
              aria-label={`Удалить сотрудника ${user.displayName}`}
            >
              <TrashIcon size={19} />
              {confirmDelete && (
                <span className="user-row__trash-text">Удалить?</span>
              )}
            </button>
          )}
        </div>
      </div>

      {passwordSaved && <div className="user-row__saved">Пароль обновлён</div>}
      {deleteError && <div className="inline-error">{deleteError}</div>}

      {editingPassword && (
        <PasswordEditor
          userId={user.id}
          onDone={() => {
            setEditingPassword(false);
            setPasswordSaved(true);
          }}
          onCancel={() => setEditingPassword(false)}
        />
      )}
    </div>
  );
}

// --- Inline "change password" editor ------------------------------------------
interface PasswordEditorProps {
  userId: number;
  onDone: () => void;
  onCancel: () => void;
}

function PasswordEditor({
  userId,
  onDone,
  onCancel,
}: PasswordEditorProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    if (saving) return;
    if (password.length < 6) {
      setError('Пароль: минимум 6 символов');
      return;
    }
    if (password.length > 72) {
      setError('Пароль: максимум 72 символа');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminSetPassword(userId, password);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Не удалось сменить пароль',
      );
      setSaving(false);
    }
  }

  return (
    <div className="user-row__panel">
      <div className="pass-field">
        <input
          className="users-input pass-field__input"
          type={visible ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Новый пароль (мин. 6 символов)"
          autoComplete="new-password"
          autoFocus
        />
        <button
          type="button"
          className="pass-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        >
          {visible ? 'Скрыть' : 'Показать'}
        </button>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="user-row__panel-actions">
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
          onClick={() => void handleSave()}
          disabled={saving || password.length < 6}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

// --- Inline "add user" form ----------------------------------------------------
interface AddUserFormProps {
  onCreated: () => Promise<void>;
  onClose: () => void;
}

function AddUserForm({ onCreated, onClose }: AddUserFormProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  function validate(): string | null {
    if (!USERNAME_RE.test(username.trim())) {
      return 'Логин: 3–30 символов, строчная латиница, цифры и «_», первый символ — буква';
    }
    const name = displayName.trim();
    if (!name) return 'Укажите имя';
    if (name.length > 100) return 'Имя: до 100 символов';
    if (password.length < 6) return 'Пароль: минимум 6 символов';
    if (password.length > 72) return 'Пароль: максимум 72 символа';
    return null;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (saving) return;
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError(null);
    setCreated(false);
    try {
      await api.adminCreateUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setVisible(false);
      setCreated(true);
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 409 ? 'Логин уже занят' : err.message);
      } else {
        setError('Не удалось создать сотрудника');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="users-form" onSubmit={handleSubmit} autoComplete="off">
      <h2 className="users-form__title">Новый сотрудник</h2>

      <label className="users-form__field">
        <span className="users-form__label">Логин (латиницей)</span>
        <input
          className="users-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="ivan_petrov"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={saving}
          autoFocus
        />
      </label>

      <label className="users-form__field">
        <span className="users-form__label">Имя</span>
        <input
          className="users-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Иван Петров"
          autoComplete="off"
          disabled={saving}
        />
      </label>

      <label className="users-form__field">
        <span className="users-form__label">Пароль</span>
        <div className="pass-field">
          <input
            className="users-input pass-field__input"
            type={visible ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Минимум 6 символов"
            autoComplete="new-password"
            disabled={saving}
          />
          <button
            type="button"
            className="pass-field__toggle"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {visible ? 'Скрыть' : 'Показать'}
          </button>
        </div>
      </label>

      {error && <div className="inline-error">{error}</div>}
      {created && (
        <div className="users-form__success">
          Передайте сотруднику логин и пароль
        </div>
      )}

      <div className="users-form__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClose}
          disabled={saving}
        >
          {created ? 'Готово' : 'Отмена'}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving || !username.trim() || !displayName.trim() || !password}
        >
          {saving ? 'Сохранение…' : 'Добавить'}
        </button>
      </div>
    </form>
  );
}
