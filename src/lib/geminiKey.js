// BYOK ("Bring Your Own Key"): the user's own Google AI Studio key, kept ONLY on this device (localStorage).
// The app has no server that reads receipts any more: the browser talks to Gemini directly with this key (see gemini.js), so the
// key never travels anywhere else, is never part of the Drive backup (settings / projects are whitelisted copies) and is erased by the
// sign-out deep clean (localStorage.clear(), see session.js). Pure of React except the hook at the bottom.

import { useSyncExternalStore } from 'react';

export const GEMINI_KEY_STORAGE = 'cp.geminiKey.v1';
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey'; // where the user creates a free key

// AI Studio keys are one opaque token (letters, digits, "-", "_" and, in newer formats, "."): no spaces, no quotes, no markup.
const KEY_RE = /^[A-Za-z0-9_.-]{20,200}$/;

/** What the user typed or pasted -> a clean key, or '' when it cannot be one (surrounding spaces / quotes are forgiven). */
export function cleanGeminiKey(raw) {
  if (typeof raw !== 'string') return '';
  const key = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  return KEY_RE.test(key) ? key : '';
}

let memory = ''; // when localStorage is unavailable or full (private mode, some embedded browsers) the key still serves this session
let memoryOnly = false; // true only while the last write could NOT reach localStorage
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

const storage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The stored key, or '' (always re-read: the sign-out wipe or another tab may have changed it). */
export function getGeminiKey() {
  const local = storage();
  if (local) {
    try {
      const stored = local.getItem(GEMINI_KEY_STORAGE);
      if (typeof stored === 'string') return cleanGeminiKey(stored);
      return memoryOnly ? memory : ''; // nothing stored: removed, or wiped by the sign-out clean (never resurrect it from memory)
    } catch {
      /* unreadable storage: memory */
    }
  }
  return memory;
}

export const hasGeminiKey = () => getGeminiKey() !== '';

/** Save the key. Returns the clean key that was stored, or '' when `raw` is not a usable key (nothing changes then). */
export function setGeminiKey(raw) {
  const key = cleanGeminiKey(raw);
  if (!key) return '';
  memory = key;
  memoryOnly = false;
  try {
    const local = storage();
    if (local) local.setItem(GEMINI_KEY_STORAGE, key);
    else memoryOnly = true;
  } catch {
    memoryOnly = true; // memory only
  }
  emit();
  return key;
}

export function clearGeminiKey() {
  memory = '';
  memoryOnly = false;
  try {
    storage()?.removeItem(GEMINI_KEY_STORAGE);
  } catch {
    /* nothing to remove */
  }
  emit();
}

/** "••••k9Zt": the key is never shown whole once saved, only its last four characters. */
export const maskGeminiKey = (key) => (key ? `••••${String(key).slice(-4)}` : '');

export const subscribeGeminiKey = (fn) => {
  listeners.add(fn);
  const onStorage = (e) => (e?.key === GEMINI_KEY_STORAGE || e?.key === null) && fn(); // another tab (or a clear()) changed it
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

/** The user's key as React state ('' = none): re-renders when it is saved or removed. */
export const useGeminiKey = () => useSyncExternalStore(subscribeGeminiKey, getGeminiKey, () => '');
