// "Instalar App". Chromium fires `beforeinstallprompt` ONCE, early, and only if nobody has used it yet. The listener is
// therefore registered when this module is imported (main.jsx imports it before React renders), and the event is kept
// here, so no screen can miss it however late it mounts. Browsers that never fire it (iOS Safari, Firefox...) get a
// short manual instruction instead of a dead button.

// Two layers keep the event: /install-capture.js (a tiny classic script in <head>, runs BEFORE the app bundle is even downloaded and keeps
// the event in window.__cubraxInstall) and the listener below (registered when main.jsx runs). The module adopts what the early script saw.

const INSTALLED_KEY = 'cubrax.installed';
let deferred = null; // the global `deferredPrompt`
let installed = false;
let prompting = false;
const listeners = new Set();
let started = false;
const emit = () => listeners.forEach((fn) => fn());

const store = (win) => {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
};
/** The OS installed the app (appinstalled): the button stays hidden for good, also in later visits from the browser tab. */
const rememberInstalled = (win) => {
  try {
    store(win)?.setItem(INSTALLED_KEY, '1');
  } catch {
    /* private mode: the session flag is enough */
  }
};
/** `beforeinstallprompt` only fires when the app is NOT installed (it was uninstalled meanwhile): the button may come back. */
const forgetInstalled = (win) => {
  try {
    store(win)?.removeItem(INSTALLED_KEY);
  } catch {
    /* ignore */
  }
};
const wasInstalled = (win = typeof window === 'undefined' ? null : window) => {
  try {
    return store(win)?.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
};

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
  installed = isStandalone(win) || wasInstalled(win);
  const early = win.__cubraxInstall; // what the head script already saw before this bundle ran
  if (early?.event) {
    deferred = early.event;
    forgetInstalled(win);
    installed = isStandalone(win);
  }
  if (early?.installed) {
    installed = true;
    deferred = null;
    rememberInstalled(win);
  }
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e;
    installed = isStandalone(win);
    forgetInstalled(win);
    emit();
  });
  win.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    rememberInstalled(win);
    emit();
  });
  try {
    win.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', emit); // launched / moved into an app window
  } catch {
    /* old engines */
  }
  if (early) emit();
}

export const getInstallState = () => ({ canPrompt: Boolean(deferred), installed: installed || isStandalone() });
export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Tap on "Instalar App": with the captured event it opens the browser's NATIVE install dialog (it must be called inside the tap), waits for
 * the user's choice and then clears the stored event (a prompt can only be used once).
 * @returns 'accepted' | 'dismissed' (the native dialog was shown) | 'manual' (deferredPrompt is null: the caller shows the instructions
 *          for this browser, e.g. iOS Safari) | 'installed'
 */
export async function promptInstall() {
  if (getInstallState().installed) return 'installed';
  if (!deferred || prompting) return deferred ? 'dismissed' : 'manual';
  const ev = deferred;
  prompting = true;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'manual';
  } finally {
    prompting = false;
    deferred = null; // spent: the browser fires a new event when it allows another offer
    emit();
  }
}

/** Test helper. */
export function __resetInstallForTests() {
  deferred = null;
  installed = false;
  prompting = false;
  started = false;
  try {
    localStorage.removeItem(INSTALLED_KEY);
    delete window.__cubraxInstall;
  } catch {
    /* ignore */
  }
  listeners.clear();
}
