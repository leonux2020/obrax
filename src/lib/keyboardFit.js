import { useEffect } from 'react';

/** Air kept between the last visible row and the keyboard, px. */
export const KEYBOARD_GAP = 8;
/** Below this the keyboard leaves no room worth fitting (landscape phones): the natural layout stays. */
export const MIN_ROOM = 120;

/**
 * FOCUS TAKEOVER: while a search field has the focus (`active`), the on-screen keyboard covers the bottom of the screen and, with it, the lower
 * rows of a list that is anchored to the bottom of the sheet. This keeps the results block (`ref`) exactly as tall as the room that is
 * really visible: from its top edge to the top of the keyboard (`window.visualViewport`), so its own scroll (`overflow-y-auto`) reaches every name.
 * It follows the keyboard opening / closing / rotating, and lets go (no inline height left) as soon as `active` is false. Where there is no
 * visualViewport (old browsers, tests) nothing happens and the natural `flex-1` layout stays.
 */
export function useKeyboardFit(ref, active) {
  useEffect(() => {
    const el = ref.current;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!el || !vv || !active) return undefined;
    const fit = () => {
      const room = Math.floor(vv.offsetTop + vv.height - el.getBoundingClientRect().top - KEYBOARD_GAP);
      el.style.maxHeight = room >= MIN_ROOM ? `${room}px` : '';
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.maxHeight = '';
    };
  }, [ref, active]);
}
