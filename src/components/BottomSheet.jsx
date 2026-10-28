import { useEffect, useId, useRef } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { useHistoryBack } from '../lib/useHistoryBack.js';

const SWIPE_CLOSE_PX = 90;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet (one-hand ergonomics): anchored to the bottom of the screen, pure #000 with an ultra
 * thin border. Focus is trapped inside, Escape / backdrop close it and focus returns to the opener.
 */
export default function BottomSheet({ title, subtitle, onClose, fullscreen = false, swipeToClose = false, backClose = false, children }) {
  const { t } = useI18n();
  const titleId = useId();
  const ref = useRef(null);
  // backClose: while the sheet is open ONE history entry ({ modalOpen: true }) is pushed; the device's Back pops it and only closes the
  // sheet (the screen underneath stays). Any other way of closing (x, backdrop, swipe, Escape) drops that entry, so no "Back twice".
  useHistoryBack(backClose ? 'open' : null, onClose, 'cubraxSheet', { state: { modalOpen: true }, cleanup: true });
  const drag = useRef(null); // { y0, dy } while a downward swipe that started at the very top of the sheet is under way

  // opt-in swipe down to close: only when the sheet is scrolled to its top, past SWIPE_CLOSE_PX it closes, otherwise it springs back
  const swipe = !swipeToClose
    ? {}
    : {
        onTouchStart: (e) => {
          drag.current = e.touches.length === 1 && (ref.current?.scrollTop ?? 0) <= 0 ? { y0: e.touches[0].clientY, dy: 0 } : null;
        },
        onTouchMove: (e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          d.dy = Math.max(0, e.touches[0].clientY - d.y0);
          ref.current.style.transform = d.dy > 0 ? `translateY(${d.dy}px)` : '';
        },
        onTouchEnd: () => {
          const d = drag.current;
          drag.current = null;
          if (!d || !ref.current) return;
          ref.current.style.transform = '';
          if (d.dy > SWIPE_CLOSE_PX) onClose();
        },
        onTouchCancel: () => {
          drag.current = null;
          if (ref.current) ref.current.style.transform = '';
        },
      };

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input, select, button:not([data-sheet-close])')?.focus({ preventScroll: true });
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
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/80"
      data-testid="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // only the dark area: a tap inside the sheet does nothing
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-swipe-close={swipeToClose ? 'true' : undefined}
        {...swipe}
        className={`${swipeToClose ? 'sheet-slide ' : ''}relative w-full overflow-y-auto border border-white/10 bg-black p-5 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))] ${
          fullscreen ? 'h-[100dvh] max-w-none border-0 sm:mx-auto sm:max-w-3xl sm:border' : 'max-h-[92vh] max-w-lg rounded-t-3xl border-b-0'
        }`}
      >
        {swipeToClose && <div aria-hidden="true" className="mx-auto -mt-2 mb-2 h-1 w-10 rounded-full bg-white/20" />}
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
