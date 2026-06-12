// @vitest-environment jsdom
//
// Regression tests for the view-first TaskRow editor.
// Blocker (review): activating a field without editing it must NOT make the
// Сохранить button send a no-op PATCH («пустой PATCH не уходит при
// отсутствии изменений»).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskRow } from '../components/TaskRow';
import type { Task, User } from '../types';

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

function renderExpanded(task: Task, currentUser: User, onSave = vi.fn()) {
  const utils = render(
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
    />,
  );
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
