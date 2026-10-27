import { useEffect, useRef } from 'react';

// The device's BACK button (Android hardware / gesture, browser arrow) inside the single-page app.
//
// Opening a project pushes ONE history entry ({ cubraxProject: id }); the "back" of the device then pops it and
// `onLeave()` runs: the very same function the "←" arrow of the screen runs, so both paths end on the Dashboard and the browser
// never leaves the app (or the domain) from inside a project. The other way round, when the app itself closes the project
// (arrow, deleting it...) the entry it pushed is popped too, so the history never piles up and a later "back" at the Dashboard
// behaves like in any other web page. Opening another project from inside one (an extension) re-labels the entry instead of
// pushing a second one.

const KEY = 'cubraxProject';
const SELF_POP_MS = 600; // a popstate this soon after our own history.back() is that very pop

const marker = () => {
  try {
    return window.history.state?.[KEY] ?? null;
  } catch {
    return null;
  }
};

/**
 * @param activeId  id of the open project, or null at the Dashboard
 * @param onLeave   called when the device's back button is pressed while a project is open
 */
export function useHistoryBack(activeId, onLeave) {
  const leave = useRef(onLeave);
  const active = useRef(activeId);
  const pushed = useRef(false); // true while the entry WE pushed is on top of the history
  const selfPop = useRef(0);
  leave.current = onLeave;
  active.current = activeId;

  // a reload keeps window.history.state: the app starts at the Dashboard, so a stale marker is cleared (never "back" out of the app)
  useEffect(() => {
    if (marker()) window.history.replaceState(null, '');
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (Date.now() < selfPop.current) {
        selfPop.current = 0; // our own pop (the app closed the project first)
        return;
      }
      pushed.current = false;
      if (active.current) leave.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (activeId) {
      if (marker() === activeId) {
        pushed.current = true;
      } else if (marker()) {
        window.history.replaceState({ [KEY]: activeId }, ''); // another project from inside one: same entry
        pushed.current = true;
      } else {
        window.history.pushState({ [KEY]: activeId }, '');
        pushed.current = true;
      }
    } else if (pushed.current && marker()) {
      pushed.current = false;
      selfPop.current = Date.now() + SELF_POP_MS;
      window.history.back(); // the app closed the project: drop the entry it had pushed
    }
  }, [activeId]);
}
