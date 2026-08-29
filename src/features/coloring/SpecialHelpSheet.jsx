import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SPECIAL_HELP_ITEMS } from '../../lib/specialHelp';
import './specialHelp.css';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Compact always-available legend for the six special-cell kinds. */
export default function SpecialHelpSheet({ open, onClose, returnFocusRef = null }) {
  const sheetRef = useRef(null);
  const previousFocusRef = useRef(null);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const container = sheetRef.current;
    if (!container) return;
    const focusables = [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((el) => !el.disabled && el.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      const focusTarget = returnFocusRef?.current || previousFocusRef.current;
      if (focusTarget
        && focusTarget.isConnected !== false
        && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
      }
      previousFocusRef.current = null;
      if (returnFocusRef) returnFocusRef.current = null;
      return undefined;
    }
    previousFocusRef.current = document.activeElement;
    document.addEventListener('keydown', handleKeyDown, true);
    sheetRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, handleKeyDown, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="special-help-overlay" role="presentation" data-special-help-open onClick={onClose}>
      <section
        className="special-help-sheet"
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="special-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="special-help-close" type="button" onClick={onClose} aria-label="Закрыть памятку">
          <X size={20} />
        </button>
        <h3 id="special-help-title">Особые клетки</h3>
        <ul className="special-help-list">
          {SPECIAL_HELP_ITEMS.map((item) => (
            <li className="special-help-item" key={item.kind} data-special-help-kind={item.kind}>
              <i className="special-help-mark" data-special-help-kind={item.kind} aria-hidden="true" />
              <span className="special-help-copy">
                <b>{item.label}</b>
                <small>{item.short}</small>
              </span>
            </li>
          ))}
        </ul>
        <div className="special-help-actions">
          <button className="primary-button" type="button" onClick={onClose}>Понятно</button>
        </div>
      </section>
    </div>
  );
}
