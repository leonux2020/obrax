import { useEffect } from 'react';

/** Below this the keyboard is not really up (browser chrome moving, a pinch zoom): the sheet is left alone. */
export const KEYBOARD_MIN = 100;
/** Air kept above the sheet when it is shrunk to the visible part of the screen, px. */
export const SHEET_TOP_GAP = 12;

/**
 * KEYBOARD DOCK: a sheet anchored to the bottom of the screen is covered by the on-screen keyboard (it overlays the page instead of resizing it
 * in most mobile browsers), and with it whatever sits at the bottom of the sheet, such as a search field. While the keyboard is up this lifts the
 * sheet to rest exactly ON TOP of it (padding under the backdrop = the keyboard's height) and caps its height to the visible part of the screen,
 * so the field at the bottom stays in sight and anything that drops up from it has the whole free space above. It follows the keyboard
 * opening, closing and rotating (`window.visualViewport`) and puts everything back when the keyboard goes down or the sheet unmounts.
 * Where there is no visualViewport (old browsers, tests) nothing happens.
 */
export function useKeyboardDock(dialogRef, enabled) {
  useEffect(() => {
    const dialog = dialogRef.current;
    const backdrop = dialog?.parentElement;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!enabled || !dialog || !backdrop || !vv) return undefined;
    const reset = () => {
      backdrop.style.paddingBottom = '';
      dialog.style.maxHeight = '';
      delete dialog.dataset.keyboard;
    };
    const fit = () => {
      const inset = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      if (inset < KEYBOARD_MIN) return reset();
      backdrop.style.paddingBottom = `${inset}px`;
      dialog.style.maxHeight = `${Math.max(0, Math.floor(vv.height - SHEET_TOP_GAP))}px`;
      dialog.dataset.keyboard = 'true';
      return undefined;
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      reset();
    };
  }, [dialogRef, enabled]);
}
