import { useEffect, useRef } from 'react';

// Universal back stack (LIFO) for every overlay of the app: bottom sheets, the photo viewer, the number pad, the camera...
//
// Each open layer pushes ONE history entry ({ cubraxLayer: id, modalOpen: true }) when it mounts and registers itself on a stack.
//  - The device's Back pops the top entry: ONLY the topmost layer closes (the one below stays, the screen underneath is untouched
//    and nobody else hears that popstate). Several layers close one per press, last opened first.
//  - Any other way of closing (x, backdrop, swipe, Escape, the parent unmounting it) releases the layer and drops its entry with a
//    single history.back() when that entry is the current one, so no garbage is left and "Back twice" never happens.
//  - The reconciliation is state based, never time based: after a popstate every layer whose entry is gone is closed; a popstate that
//    lands on an entry of a layer that no longer exists (an "orphan": its owner closed it while something else was pushed above)
//    is skipped with one more back(), so the user never has to press Back on a dead entry.
// The project / tab hooks (useHistoryBack) keep their own markers underneath; a layer is always above them.

const KEY = 'cubraxLayer';
const stack = []; // [{ id, popped }] oldest first
let seq = 0;
let ready = false;

const state = () => {
  try {
    return window.history.state;
  } catch {
    return null;
  }
};

function onPop(ev) {
  const id = ev?.state?.[KEY] ?? null;
  const at = id ? stack.findIndex((l) => l.id === id) : -1;
  const gone = stack.splice(at + 1); // every layer above the entry we landed on lost its entry
  if (gone.length) {
    ev.stopImmediatePropagation(); // a layer consumed the Back press: the rest of the app does not react
    for (const layer of gone.reverse()) layer.popped();
  }
  if (id && at === -1) {
    try {
      window.history.back(); // landed on a dead layer entry: skip it
    } catch {
      /* no history */
    }
  }
}

function install() {
  if (ready || typeof window === 'undefined') return;
  ready = true;
  if (state()?.[KEY]) window.history.replaceState(null, ''); // a reload keeps window.history.state: start clean, never "back" out of the app
  window.addEventListener('popstate', onPop, true); // capture + registered first: sees the pop before any other layer of the app
}

/** Registers a layer and pushes its entry. `popped()` runs when the device's Back removed that entry. Returns the layer id. */
export function acquireLayer(popped) {
  install();
  const id = `L${++seq}`;
  stack.push({ id, popped });
  try {
    window.history.pushState({ [KEY]: id, modalOpen: true }, '');
  } catch {
    /* no history */
  }
  return id;
}

/** The owner closed the layer: forget it and drop its entry if it is still the current one. Safe to call twice. */
export function releaseLayer(id) {
  const at = stack.findIndex((l) => l.id === id);
  if (at === -1) return; // Back already took it
  stack.splice(at, 1);
  // deferred a microtask: when a screen change pushes its own entry in the same commit, that entry must not be the one popped
  Promise.resolve().then(() => {
    if (state()?.[KEY] === id) {
      try {
        window.history.back();
      } catch {
        /* no history */
      }
    }
  });
}

/** Number of open layers (tests / diagnostics). */
export const layerDepth = () => stack.length;

/**
 * Makes the component a back-stack layer for as long as it is mounted (and `enabled`): the device's Back calls `onClose`.
 * `onClose` may change between renders; it must unmount / hide the component.
 */
export function useBackLayer(onClose, enabled = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled) return undefined;
    const id = acquireLayer(() => close.current?.());
    return () => releaseLayer(id);
  }, [enabled]);
}
