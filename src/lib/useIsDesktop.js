import { useSyncExternalStore } from 'react';

/** From this width (px) the app is CUBRAX Studio (three columns); below it, the phone interface with its bottom navigation. */
export const DESKTOP_MIN_WIDTH = 1024;

/** Pure rule, so it can be tested without a window: a real number >= 1024. Anything else (NaN, undefined, 0) is "not a desktop". */
export const isDesktopWidth = (width) => typeof width === 'number' && Number.isFinite(width) && width >= DESKTOP_MIN_WIDTH;

const subscribe = (notify) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', notify);
  window.addEventListener('orientationchange', notify);
  return () => {
    window.removeEventListener('resize', notify);
    window.removeEventListener('orientationchange', notify);
  };
};
const snapshot = () => (typeof window === 'undefined' ? false : isDesktopWidth(window.innerWidth));

/** true on a desktop-width window. Follows the window live (resize / rotation); on the server or without a window: false (the phone interface is the default). */
export function useIsDesktop() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
