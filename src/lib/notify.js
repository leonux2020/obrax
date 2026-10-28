// Tiny notification bus: in-app toasts (always) + a system notification when the app is in the background and the user
// allowed it. Messages are { key, params } (an i18n key), translated where they are shown, so every language works.

import { useSyncExternalStore } from 'react';

let seq = 0;
let toasts = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const subscribeToasts = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getToasts = () => toasts;
export const useToasts = () => useSyncExternalStore(subscribeToasts, getToasts, () => []);

export function dismissToast(id) {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

/** Show a toast. `tone`: 'info' | 'ok' | 'warn'. Auto-dismissed after `ms` (0 = stays until dismissed). */
export function pushToast({ key, params, tone = 'info', ms = 3500 }) {
  seq += 1;
  const id = seq;
  toasts = [...toasts.slice(-2), { id, key, params, tone }];
  emit();
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return id;
}
/** Change a toast that is already on screen (same place, new text / tone). A new `ms` re-arms its auto-dismiss; 0 keeps it. Returns false when it is gone. */
export function updateToast(id, { key, params, tone, ms = 3500 }) {
  if (!toasts.some((x) => x.id === id)) return false;
  toasts = toasts.map((x) => (x.id === id ? { ...x, key, params, tone: tone ?? x.tone } : x));
  emit();
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return true;
}
export const resetToasts = () => {
  toasts = [];
  emit();
};

/** Ask for the system-notification permission (call from a user gesture, e.g. when a receipt is parked). Never throws. */
export async function askNotifyPermission() {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** System notification, only while the page is hidden (a visible app already shows the toast). */
export function systemNotify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false;
    new Notification(title, { body, tag: 'cubrax-receipts', icon: './icon-192.png' });
    return true;
  } catch {
    return false;
  }
}
