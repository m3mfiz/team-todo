// @vitest-environment jsdom
//
// Regression test (review): Escape must close only the topmost sheet.
// AddSheet and its nested WhenSheet both listen for a window-level Escape
// keydown — a single press must not discard the whole new-task draft.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AddSheet } from '../components/AddSheet';
import type { User } from '../types';

afterEach(cleanup);

const admin: User = {
  id: 1,
  username: 'admin',
  displayName: 'Админ',
  role: 'admin',
};

describe('AddSheet', () => {
  it('one Escape closes only the nested WhenSheet, keeping AddSheet mounted', () => {
    const onClose = vi.fn();
    render(
      <AddSheet
        currentUser={admin}
        members={[admin]}
        onClose={onClose}
        onCreate={() => Promise.resolve()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    expect(screen.getByRole('dialog', { name: 'Срок' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Срок' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Новая задача' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
