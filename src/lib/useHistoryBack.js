import { useEffect, useRef } from 'react';

// The device's BACK button (Android hardware / gesture, browser arrow) inside the single-page app.
//
// Opening a project pushes ONE history entry ({ cubraxProject: id }); the "back" of the device then pops it and
// `onLeave()` runs: the very same function the "←" arrow of the screen runs, so both paths end on the Dashboard and the browser
// never leaves the app (or the domain) from inside a project. The other way round, when the app itself closes the project
// (arrow, deleting it...) the entry it pushed is popped too, so the history never piles up and a later "back" at the Dashboard
// behaves like in any other web page. Opening another project from inside one (an extension) re-labels the entry instead of
// pushing a second one.
//
// The same machinery serves the screen-level layers (the open project, the Accounting tab): each owns a history-state `key`.
// Overlays (sheets, photo viewer, pads, camera) live in backStack.js instead. A popstate is handled by the hook whose marker the
// new entry no longer carries (its own entry was the one popped) and it is consumed (stopImmediatePropagation) so no other layer
// sees it; a hook whose marker is still in the new state knows a layer ABOVE it was popped and does nothing.

const KEY = 'cubraxProject';
const SELF_POP_MS = 600; // a popstate this soon after our own history.back() is that very pop

const marker = (key = KEY) => {
  try {
    return window.history.state?.[key] ?? null;
  } catch {
    return null;
  }
};

/**
 * @param activeId  id of the open project, or null at the Dashboard
 * @param onLeave   called when the device's back button is pressed while a project is open
 * @param key       history-state marker; the default is the project one (the Accounting tab uses 'cubraxTab')
 */
export function useHistoryBack(activeId, onLeave, key = KEY) {
  const leave = useRef(onLeave);
  const active = useRef(activeId);
  const pushed = useRef(false); // true while the entry WE pushed is on top of the history
  const selfPop = useRef(0);
  leave.current = onLeave;
  active.current = activeId;

  // a reload keeps window.history.state: the app starts at the Dashboard, so a stale marker is cleared (never "back" out of the app)
  useEffect(() => {
    if (marker(key)) window.history.replaceState(null, '');
  }, []);

  useEffect(() => {
    const onPop = (ev) => {
      if (Date.now() < selfPop.current) {
        selfPop.current = 0; // our own pop (the app closed the layer first)
        ev.stopImmediatePropagation();
        return;
      }
      if (active.current && ev?.state?.[key] === active.current) return; // a layer ABOVE ours was popped: ours is still there
      const mine = pushed.current;
      pushed.current = false;
      if (active.current) {
        if (mine) ev.stopImmediatePropagation(); // our entry was consumed by the back press: nobody else reacts to it
        leave.current();
      }
    };
    window.addEventListener('popstate', onPop, true);
    return () => window.removeEventListener('popstate', onPop, true);
  }, [key]);

  useEffect(() => {
    if (activeId) {
      if (marker(key) === activeId) {
        pushed.current = true;
      } else if (marker(key)) {
        window.history.replaceState({ [key]: activeId }, ''); // another project from inside one: same entry
        pushed.current = true;
      } else {
        window.history.pushState({ [key]: activeId }, '');
        pushed.current = true;
      }
    } else if (pushed.current && marker(key)) {
      pushed.current = false;
      selfPop.current = Date.now() + SELF_POP_MS;
      window.history.back(); // the app closed the project: drop the entry it had pushed
    }
  }, [activeId]);
}
