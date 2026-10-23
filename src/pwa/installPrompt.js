// "Instalar App". Chromium fires `beforeinstallprompt` ONCE, early, and only if nobody has used it yet. The listener is
// therefore registered when this module is imported (main.jsx imports it before React renders), and the event is kept
// here, so no screen can miss it however late it mounts. Browsers that never fire it (iOS Safari, Firefox...) get a
// short manual instruction instead of a dead button.

let deferred = null;
let installed = false;
const listeners = new Set();
let started = false;
const emit = () => listeners.forEach((fn) => fn());

/** Installed already? (running as an app window / added to the home screen) */
export function isStandalone(win = typeof window === 'undefined' ? null : window) {
  if (!win) return false;
  try {
    return Boolean(win.matchMedia?.('(display-mode: standalone)')?.matches || win.matchMedia?.('(display-mode: window-controls-overlay)')?.matches || win.navigator?.standalone === true);
  } catch {
    return false;
  }
}

export const isIOS = (nav = typeof navigator === 'undefined' ? null : navigator) => Boolean(nav) && (/iphone|ipad|ipod/i.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));

/** Start listening (idempotent). Call as early as possible. */
export function startInstallCapture(win = typeof window === 'undefined' ? null : window) {
  if (!win || started) return;
  started = true;
  installed = isStandalone(win);
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e;
    emit();
  });
  win.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export const getInstallState = () => ({ canPrompt: Boolean(deferred), installed: installed || isStandalone() });
export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Tap on "Instalar App".
 * @returns 'accepted' | 'dismissed' (the browser's own install dialog was shown) | 'manual' (no dialog available:
 *          the caller shows the instructions for this browser) | 'installed'
 */
export async function promptInstall() {
  if (getInstallState().installed) return 'installed';
  if (!deferred) return 'manual';
  const ev = deferred;
  deferred = null; // a prompt can only be used once
  emit();
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'manual';
  }
}

/** Test helper. */
export function __resetInstallForTests() {
  deferred = null;
  installed = false;
  started = false;
  listeners.clear();
}
