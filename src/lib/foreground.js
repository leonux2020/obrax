// Smart Sync: the app only talks to the network (non-critical traffic) while somebody is looking at it.
//
//  - `isHidden()` is true while the page is in the background (tab switched, phone locked, PWA minimised).
//  - `onForeground(cb)` runs `cb` GENTLY when the app comes back to the front: after RESUME_MS, never inside the very frame of the
//    `visibilitychange` event, so the first paint of the returning screen is never competing with a burst of requests.
//
// What is paused: the weather lookups (card badge and header chip), the clock tick of the Dashboard and the retry timers of the deferred
// receipt / export queues. What is NEVER paused: saving the user's own data (the project flush on `hidden`, the Drive push) - leaving the
// app must not strand a change.

export const RESUME_MS = 600;

export const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Calls `cb` softly each time the app returns to the foreground. Returns the unsubscribe function. */
export function onForeground(cb, { delay = RESUME_MS } = {}) {
  if (typeof document === 'undefined') return () => {};
  let timer = 0;
  const onChange = () => {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') timer = setTimeout(() => !isHidden() && cb(), delay);
  };
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onChange);
  };
}
