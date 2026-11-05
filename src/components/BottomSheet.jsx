import { useEffect, useId, useRef } from 'react';
import { useBackLayer } from '../lib/backStack.js';
import { useKeyboardDock } from '../lib/keyboardDock.js';
import { useSheetSwipe } from '../lib/useSheetSwipe.js';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet (one-hand ergonomics): EVERY sheet of the app rises from the bottom (`sheet-slide`, a short ease-out) over a softly fading backdrop;
 * `prefers-reduced-motion` and the battery `eco-mode` switch every animation off in index.css. There is NO close x: the header is the title on the
 * left and, optionally, ONE control on the right (`headerAction`: a pencil, a total, a filter). Every sheet closes the native way: swipe down
 * (on by default, `swipeToClose={false}` is the explicit opt-out nobody uses), the device Back (back stack), the backdrop and Escape. Anchored to the bottom of the screen, pure #000 with an ultra
 * thin border (`tall`: an expanded sheet, 85 % of the screen, for dense lists; `fill`: the sheet does not scroll as a whole, it is a flex column whose body
 * (a `min-h-0 flex-1` block) owns the scroll, so a search field stays put; `dock`: while the on-screen keyboard is up the sheet rests on top of it and shrinks to the visible screen). Focus is trapped inside and returns to the opener.
 */
export default function BottomSheet({ title, subtitle, onClose, fullscreen = false, tall = false, fill = false, dock = false, swipeToClose = true, autoFocus = true, headerAction = null, children }) {
  const titleId = useId();
  const ref = useRef(null);
  // Back-stack layer: opening pushes one history entry; the device's Back closes only this sheet (or the topmost layer above it);
  // closing by backdrop / swipe / Escape drops the entry again (see lib/backStack.js).
  useBackLayer(onClose);
  const swipe = useSheetSwipe(ref, onClose, swipeToClose);
  useKeyboardDock(ref, dock); // `dock`: the sheet rides on top of the on-screen keyboard (a field at its bottom stays in sight)

  useEffect(() => {
    const previous = document.activeElement;
    // menu sheets (autoFocus={false}) focus the dialog itself: no field grabs the focus (and the on-screen keyboard) just by opening one
    // the first field / button of the BODY (never the control of the header)
    const first = autoFocus ? [...(ref.current?.querySelectorAll('input, select, button') ?? [])].find((n) => !n.closest('[data-sheet-header]')) : null;
    (first ?? ref.current)?.focus({ preventScroll: true });
    const onKey = (e) => {
      // sheets can be stacked (a form sheet over a menu sheet): only the topmost one (the last dialog in the document) answers the keyboard
      if ([...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current) return;
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
      className="sheet-fade no-print fixed inset-0 z-50 flex items-end justify-center bg-black/80"
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
        tabIndex={-1}
        data-swipe-close={swipeToClose ? 'true' : undefined}
        {...swipe}
        className={`sheet-slide relative w-full outline-none ${fill ? 'flex flex-col' : 'overflow-y-auto'} overscroll-contain border border-white/10 bg-black p-5 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))] ${
          fullscreen ? 'h-[100dvh] max-w-none border-0 sm:mx-auto sm:max-w-3xl sm:border' : tall ? 'h-[85vh] max-h-[92vh] max-w-lg rounded-t-3xl border-b-0' : 'max-h-[92vh] max-w-lg rounded-t-3xl border-b-0'
        }`}
      >
        {swipeToClose && <div aria-hidden="true" data-testid="sheet-handle" className="mx-auto -mt-2 mb-2 h-1 w-10 shrink-0 rounded-full bg-white/20" />}
        <div className="mb-1 flex min-h-[44px] shrink-0 items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0 text-2xl font-medium tracking-tight">
            {title}
          </h2>
          {headerAction && (
            <div data-sheet-header className="shrink-0">
              {headerAction}
            </div>
          )}
        </div>
        {subtitle && <p className="mb-4 text-sm text-neutral-300">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
