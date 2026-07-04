// @vitest-environment jsdom
//
// Regression tests for the view-first TaskRow editor.
// Blocker (review): activating a field without editing it must NOT make the
// Сохранить button send a no-op PATCH («пустой PATCH не уходит при
// отсутствии изменений»).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskRow } from '../components/TaskRow';
import type { Task, UpdateTaskInput, User } from '../types';

const admin: User = {
  id: 1,
  username: 'admin',
  displayName: 'Админ',
  role: 'admin',
};
const member: User = {
  id: 2,
  username: 'lena',
  displayName: 'Лена',
  role: 'member',
};
const members: User[] = [admin, member];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 10,
    title: 'Купить молоко',
    notes: null,
    deadline: null,
    status: 'open',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    creatorId: 1,
    creatorName: 'Админ',
    assigneeId: 2,
    assigneeName: 'Лена',
    ...overrides,
  };
}

function expandedRow(
  task: Task,
  currentUser: User,
  onSave: (id: number, input: UpdateTaskInput) => Promise<void>,
) {
  return (
    <TaskRow
      task={task}
      currentUser={currentUser}
      members={members}
      expanded={true}
      onToggleExpand={() => undefined}
      onComplete={() => undefined}
      onReopen={() => undefined}
      onSave={onSave}
      onDelete={() => Promise.resolve()}
    />
  );
}

function renderExpanded(task: Task, currentUser: User, onSave = vi.fn()) {
  const utils = render(expandedRow(task, currentUser, onSave));
  return { ...utils, onSave };
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
}

afterEach(cleanup);

describe('TaskRow editor — no-op save guard', () => {
  it('does not call onSave when a field is activated but nothing changed', () => {
    const { onSave } = renderExpanded(makeTask(), admin);

    // Activate the title field without typing anything.
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать название' }));

    const save = saveButton();
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not call onSave when deadline/assignee are activated but unchanged (admin)', () => {
    const { onSave } = renderExpanded(makeTask({ deadline: '2026-06-20' }), admin);

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать срок' }));
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());

    // Deactivate via blur, then activate assignee — still no changes.
    fireEvent.blur(screen.getByDisplayValue('2026-06-20'));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать исполнителя' }));
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());

    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables save again when an edit is reverted back to the original value', () => {
    renderExpanded(makeTask(), admin);

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать название' }));
    const input = screen.getByPlaceholderText('Название');

    fireEvent.change(input, { target: { value: 'Купить молоко и хлеб' } });
    expect(saveButton().disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'Купить молоко' } });
    expect(saveButton().disabled).toBe(true);
  });

  it('whitespace-only changes are not dirty (trimmed draft equals original)', () => {
    const { onSave } = renderExpanded(makeTask(), admin);

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать название' }));
    fireEvent.change(screen.getByPlaceholderText('Название'), {
      target: { value: '  Купить молоко  ' },
    });

    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('TaskRow editor — real edits still save', () => {
  it('calls onSave once with the trimmed payload when the title changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderExpanded(makeTask(), admin, onSave);

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать название' }));
    fireEvent.change(screen.getByPlaceholderText('Название'), {
      target: { value: '  Купить кефир  ' },
    });

    const save = saveButton();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(10, {
      title: 'Купить кефир',
      notes: '',
      deadline: null,
      assigneeId: 2,
    });
    // Let the pending onSave promise settle inside the component.
    await Promise.resolve();
  });

  it('member payload contains only title/notes (no deadline/assigneeId)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderExpanded(
      makeTask({ creatorId: 2, creatorName: 'Лена', notes: 'старые' }),
      member,
      onSave,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать заметки' }));
    fireEvent.change(screen.getByPlaceholderText('Заметки'), {
      target: { value: 'новые заметки' },
    });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(10, {
      title: 'Купить молоко',
      notes: 'новые заметки',
    });
    await Promise.resolve();
  });
});

describe('TaskRow editor — draft re-sync on concurrent updates', () => {
  it('re-syncs drafts from the task when idle and updatedAt changes', () => {
    const onSave = vi.fn();
    const { rerender } = renderExpanded(
      makeTask({ notes: 'старые', deadline: '2026-06-20' }),
      admin,
      onSave,
    );

    rerender(
      expandedRow(
        makeTask({
          title: 'Купить кефир',
          notes: 'свежие',
          deadline: '2026-06-25',
          assigneeId: null,
          assigneeName: null,
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
        admin,
        onSave,
      ),
    );

    expect(
      screen.getByRole('button', { name: 'Редактировать название' }).textContent,
    ).toBe('Купить кефир');
    expect(
      screen.getByRole('button', { name: 'Редактировать заметки' }).textContent,
    ).toBe('свежие');
    expect(
      screen.getByRole('button', { name: 'Редактировать исполнителя' }).textContent,
    ).toBe('Всем');
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать срок' }));
    expect(screen.getByDisplayValue('2026-06-25')).toBeTruthy();
  });

  it('preserves drafts while a field is active', () => {
    const onSave = vi.fn();
    const { rerender } = renderExpanded(makeTask(), admin, onSave);

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать название' }));
    expect(screen.getByDisplayValue('Купить молоко')).toBeTruthy();

    rerender(
      expandedRow(
        makeTask({
          title: 'Купить кефир',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
        admin,
        onSave,
      ),
    );

    expect(screen.getByDisplayValue('Купить молоко')).toBeTruthy();
  });

  it('preserves drafts while dirty even with no active field', () => {
    const onSave = vi.fn();
    const { rerender } = renderExpanded(
      makeTask({ deadline: '2026-06-20' }),
      admin,
      onSave,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать срок' }));
    fireEvent.change(screen.getByDisplayValue('2026-06-20'), {
      target: { value: '2026-06-25' },
    });
    fireEvent.blur(screen.getByDisplayValue('2026-06-25'));

    rerender(
      expandedRow(
        makeTask({
          title: 'Купить кефир',
          deadline: '2026-06-20',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
        admin,
        onSave,
      ),
    );

    expect(
      screen.getByRole('button', { name: 'Редактировать название' }).textContent,
    ).toBe('Купить молоко');
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать срок' }));
    expect(screen.getByDisplayValue('2026-06-25')).toBeTruthy();
  });
});

describe('TaskRow editor — save errors are visible', () => {
  it('shows an inline error when save fails and clears it on the next attempt', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    renderExpanded(makeTask(), admin, onSave);

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать название' }));
    fireEvent.change(screen.getByPlaceholderText('Название'), {
      target: { value: 'Купить кефир' },
    });
    fireEvent.click(saveButton());

    expect(
      await screen.findByText('Не удалось сохранить — попробуйте ещё раз'),
    ).toBeTruthy();

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(
        screen.queryByText('Не удалось сохранить — попробуйте ещё раз'),
      ).toBeNull(),
    );
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
