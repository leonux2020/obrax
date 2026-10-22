import { useEffect, useId, useRef } from 'react';
import { useI18n } from '../lib/i18n.jsx';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet (one-hand ergonomics): anchored to the bottom of the screen, pure #000 with an ultra
 * thin border. Focus is trapped inside, Escape / backdrop close it and focus returns to the opener.
 */
export default function BottomSheet({ title, subtitle, onClose, children }) {
  const { t } = useI18n();
  const titleId = useId();
  const ref = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input, select, button:not([data-sheet-close])')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && ref.current) {
        const nodes = [...ref.current.querySelectorAll(FOCUSABLE)];
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/80">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-b-0 border-white/10 bg-black p-5 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-2xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            data-sheet-close
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-xl hover:border-brand"
          >
            ×
          </button>
        </div>
        {subtitle && <p className="mb-4 text-sm text-neutral-300">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
