import { useEffect, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { addDays, todayKey } from '../dates';

interface WhenSheetProps {
  // Current deadline key ('' when none) — seeds the custom date field and
  // decides whether «Убрать срок» is offered.
  value: string;
  // Called with a 'YYYY-MM-DD' key, or null to clear — the caller applies it
  // to its own draft/state and is responsible for closing the sheet.
  onApply: (deadline: string | null) => void;
  onClose: () => void;
  // Opened on top of another sheet (e.g. AddSheet) — raises z-index.
  nested?: boolean;
}

export function WhenSheet({
  value,
  onApply,
  onClose,
  nested,
}: WhenSheetProps): JSX.Element {
  const [customDate, setCustomDate] = useState(value);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function applyCustomDate(next: string): void {
    setCustomDate(next);
    // Clearing the native date input yields '' — treat that the same as
    // «Убрать срок» rather than silently ignoring it.
    onApply(next || null);
  }

  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);

  // Portaled to <body> so a WhenSheet opened from deep inside an expanded
  // task card (which gets its own stacking context for the B3 card lift)
  // still overlays the header/tabbar/FAB instead of being trapped beneath
  // them.
  return createPortal(
    <div
      className={`sheet-backdrop${nested ? ' sheet-backdrop--nested' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className="sheet sheet--when"
        role="dialog"
        aria-modal="true"
        aria-label="Срок"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sheet__grabber" />
        <h2 className="sheet__heading">Срок</h2>

        <button
          type="button"
          className="when-preset"
          onClick={() => onApply(today)}
        >
          Сегодня
        </button>
        <button
          type="button"
          className="when-preset"
          onClick={() => onApply(tomorrow)}
        >
          Завтра
        </button>
        <button
          type="button"
          className="when-preset"
          onClick={() => onApply(nextWeek)}
        >
          Через неделю
        </button>

        <label className="when-preset when-preset--date">
          <span>Другая дата</span>
          <input
            type="date"
            value={customDate}
            onChange={(e) => applyCustomDate(e.target.value)}
          />
        </label>

        {value && (
          <button
            type="button"
            className="when-preset when-preset--destructive"
            onClick={() => onApply(null)}
          >
            Убрать срок
          </button>
        )}

        <div className="sheet__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
