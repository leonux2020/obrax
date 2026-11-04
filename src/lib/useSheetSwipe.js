import { useRef } from 'react';

export const SWIPE_CLOSE_PX = 90;
/** A touch that starts on one of these is theirs (drawing a signature, dragging a slider): it never drags the sheet. */
const OWN_TOUCH = 'canvas, input[type="range"], [data-no-swipe]';

/**
 * Swipe down to close, for every bottom sheet (BottomSheet, NumberPad). Spread `handlers` on the dialog element and give it `ref`.
 * The drag only starts when nothing is scrolled (neither the sheet nor any scrolling list inside it) and not on a control that owns its
 * touches; past SWIPE_CLOSE_PX it calls `onClose`, otherwise the sheet springs back. `enabled = false` is the explicit opt-out.
 */
export function useSheetSwipe(ref, onClose, enabled = true) {
  const drag = useRef(null); // { y0, dy } while a downward swipe is under way

  const canDrag = (target) => {
    const root = ref.current;
    if (!root || root.scrollTop > 0) return false;
    if (target?.closest?.('[role="dialog"]') !== root) return false; // a sheet stacked inside this one answers for itself
    if (target?.closest?.(OWN_TOUCH)) return false;
    for (let el = target; el && el !== root; el = el.parentElement) if (el.scrollTop > 0) return false;
    return true;
  };

  if (!enabled) return {};
  return {
    onTouchStart: (e) => {
      drag.current = e.touches.length === 1 && canDrag(e.target) ? { y0: e.touches[0].clientY, dy: 0 } : null;
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
}
