// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WhenSheet } from '../components/WhenSheet';
import { todayKey } from '../dates';

afterEach(cleanup);

describe('WhenSheet', () => {
  it('renders the preset rows', () => {
    render(<WhenSheet value="" onApply={() => undefined} onClose={() => undefined} />);

    expect(screen.getByText('Сегодня')).toBeTruthy();
    expect(screen.getByText('Завтра')).toBeTruthy();
    expect(screen.getByText('Через неделю')).toBeTruthy();
  });

  it('applies today\'s local date when «Сегодня» is tapped', () => {
    const onApply = vi.fn();
    render(<WhenSheet value="" onApply={onApply} onClose={() => undefined} />);

    fireEvent.click(screen.getByText('Сегодня'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(todayKey());
  });

  it('hides «Убрать срок» when there is no deadline', () => {
    render(<WhenSheet value="" onApply={() => undefined} onClose={() => undefined} />);

    expect(screen.queryByText('Убрать срок')).toBeNull();
  });

  it('shows «Убрать срок» and clears via onApply(null) when a deadline is set', () => {
    const onApply = vi.fn();
    render(
      <WhenSheet value="2026-06-20" onApply={onApply} onClose={() => undefined} />,
    );

    const clear = screen.getByText('Убрать срок');
    fireEvent.click(clear);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('clearing the custom date input applies null (clears the deadline)', () => {
    const onApply = vi.fn();
    render(
      <WhenSheet value="2026-06-20" onApply={onApply} onClose={() => undefined} />,
    );

    const input = screen.getByLabelText('Другая дата') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('«Отмена» closes without calling onApply', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<WhenSheet value="2026-06-20" onApply={onApply} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
