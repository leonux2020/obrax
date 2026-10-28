// Silent Drive backup engine. Every change of the app calls `markDirty()`; a debounced upload then sends ONE
// consolidated backup to the CUBRAX folder of the user's Drive. Uploads never overlap and never lose a change:
// whatever changes while an upload is running is picked up by the next round of the same loop.
//
// The "pending" flag is persisted (`cp.backup.v1`), so a change made offline (or without a valid Drive token) is
// still uploaded later. `flush({ force, interactive })` is what Cerrar sesión waits for: it resolves ok only when the
// CURRENT state is safely in Drive.
//
// status: 'idle' (nothing to do / not enabled) | 'syncing' | 'synced' | 'pending' (waiting: no token / offline /
//         Drive refused) -> see `reason`: 'auth' | 'offline' | 'quota' | 'error'

import { serializeBackup } from './backup.js';

export const BACKUP_STATE_KEY = 'cp.backup.v1';

const readState = (storage) => {
  try {
    const raw = JSON.parse(storage?.getItem(BACKUP_STATE_KEY) ?? 'null');
    return { at: Number(raw?.at) > 0 ? Number(raw.at) : 0, dirty: raw?.dirty === true };
  } catch {
    return { at: 0, dirty: false };
  }
};

/** "Hace un momento / hace N min / h / d" of a backup time: { key, n } for the dictionary, or null without a time. Never negative. */
export function backupAge(at, now = Date.now()) {
  if (!(Number(at) > 0)) return null;
  const secs = Math.max(0, Math.floor((now - Number(at)) / 1000));
  if (secs < 60) return { key: 'backup.ago.now', n: 0 };
  if (secs < 3600) return { key: 'backup.ago.min', n: Math.floor(secs / 60) };
  if (secs < 86_400) return { key: 'backup.ago.hour', n: Math.floor(secs / 3600) };
  return { key: 'backup.ago.day', n: Math.floor(secs / 86_400) };
}

export function createDriveSync({
  client, // createDriveClient(...)
  collect, // () => Promise<backup object> : the CURRENT state of the app
  ensureToken, // ({interactive}) => Promise<string|null>
  isEnabled = () => true,
  storage = typeof localStorage === 'undefined' ? null : localStorage,
  now = () => Date.now(),
  debounceMs = 3000,
  silentRetryMs = 60_000,
  isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false, // false = airplane mode / no coverage
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  const persisted = readState(storage);
  const state = { status: 'idle', reason: '', at: persisted.at, dirty: persisted.dirty };
  const listeners = new Set();
  let timer = null;
  let inflight = null;
  let lastSilentFail = 0;

  const persist = () => {
    try {
      storage?.setItem(BACKUP_STATE_KEY, JSON.stringify({ at: state.at, dirty: state.dirty }));
    } catch {
      /* storage blocked: the in-memory flag still works */
    }
  };
  const emit = (patch) => {
    Object.assign(state, patch);
    persist();
    const snap = { ...state };
    listeners.forEach((fn) => fn(snap));
  };

  async function round({ interactive }) {
    if (!isOnline()) {
      // no coverage: nothing is sent (it cannot crash or hang); the change stays pending and goes up when the signal returns
      emit({ status: 'pending', reason: 'offline', dirty: true });
      return { ok: false, reason: 'offline' };
    }
    const silentBlocked = !interactive && lastSilentFail && now() - lastSilentFail < silentRetryMs;
    const token = silentBlocked ? null : await ensureToken({ interactive });
    if (!token) {
      if (!interactive) lastSilentFail = now();
      emit({ status: 'pending', reason: 'auth', dirty: true });
      return { ok: false, reason: 'auth' };
    }
    lastSilentFail = 0;
    // changes made from now on set `dirty` again and trigger another round of the loop
    emit({ status: 'syncing', reason: '', dirty: false });
    try {
      const text = serializeBackup(await collect());
      await client.saveBackup(text);
      emit({ at: now(), status: state.dirty ? 'syncing' : 'synced', reason: '' });
      return { ok: true };
    } catch (err) {
      const code = err?.code;
      const reason = code === 'auth' || code === 'offline' || code === 'quota' ? code : 'error';
      emit({ status: 'pending', reason, dirty: true });
      return { ok: false, reason };
    }
  }

  /**
   * Upload now. `force` uploads even if nothing is marked dirty (used before signing out).
   * Resolves { ok } or { ok: false, reason }.
   */
  async function flush({ force = false, interactive = false } = {}) {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    while (inflight) await inflight.catch(() => {});
    if (!force && !state.dirty) return { ok: true };
    let result = { ok: true };
    inflight = (async () => {
      let first = true;
      while (first || state.dirty) {
        first = false;
        result = await round({ interactive });
        if (!result.ok) break;
      }
      return result;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  function schedule() {
    if (timer || !isEnabled()) return;
    timer = setTimer(() => {
      timer = null;
      flush().catch(() => {});
    }, debounceMs);
  }

  return {
    /** A change happened somewhere in the app. */
    markDirty() {
      emit({ dirty: true });
      schedule();
    },
    /** Resume after start-up / re-enable: upload whatever was left pending. */
    resume() {
      if (state.dirty) schedule();
    },
    /** The signal came back (browser 'online' event): upload what was left pending, silently. */
    retryNow() {
      if (!state.dirty || !isEnabled()) return Promise.resolve({ ok: true });
      return flush();
    },
    flush,
    getState: () => ({ ...state }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Drop the pending timer (signing out / unmounting). */
    cancel() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}
