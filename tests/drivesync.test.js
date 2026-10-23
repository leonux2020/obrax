import { describe, it, expect, vi } from 'vitest';
import { createDriveSync, BACKUP_STATE_KEY } from '../src/lib/driveSync.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function harness(over = {}) {
  const store = { current: { rev: 0 }, uploaded: [] };
  const timers = [];
  const gate = { hold: null };
  const client = {
    saveBackup: vi.fn(async (text) => {
      if (gate.hold) await gate.hold;
      if (over.fail) throw over.fail;
      store.uploaded.push(JSON.parse(text));
    }),
  };
  const storage = over.storage || memStorage();
  let clock = 1000;
  const sync = createDriveSync({
    client,
    collect: async () => ({ ...store.current }),
    ensureToken: over.ensureToken || (async () => 'tok-1234567890'),
    isEnabled: over.isEnabled || (() => true),
    storage,
    now: () => (clock += 10),
    setTimer: (fn) => timers.push(fn) && timers.length,
    clearTimer: () => {},
    debounceMs: 3000,
  });
  return { sync, store, client, timers, storage, gate, fire: async () => { const fn = timers.shift(); await fn?.(); await tick(); } };
}

describe('silent Drive backup engine', () => {
  it('changes are debounced into ONE upload that carries the latest state', async () => {
    const h = harness();
    h.store.current = { rev: 1 };
    h.sync.markDirty();
    h.store.current = { rev: 2 };
    h.sync.markDirty();
    h.store.current = { rev: 3 };
    h.sync.markDirty();
    expect(h.timers).toHaveLength(1); // one pending timer, nothing uploaded yet
    expect(h.client.saveBackup).not.toHaveBeenCalled();
    await h.fire();
    expect(h.client.saveBackup).toHaveBeenCalledTimes(1);
    expect(h.store.uploaded).toEqual([{ rev: 3 }]);
    expect(h.sync.getState()).toMatchObject({ status: 'synced', dirty: false, reason: '' });
    expect(h.sync.getState().at).toBeGreaterThan(0);
  });

  it('a change made DURING an upload is not lost: a second round uploads it, never two at once', async () => {
    const h = harness();
    let release;
    h.gate.hold = new Promise((r) => (release = r));
    h.store.current = { rev: 1 };
    h.sync.markDirty();
    const first = h.sync.flush();
    await tick();
    h.store.current = { rev: 2 };
    h.sync.markDirty(); // while rev 1 is in flight
    expect(h.client.saveBackup).toHaveBeenCalledTimes(1);
    h.gate.hold = null;
    release();
    const r = await first;
    expect(r.ok).toBe(true);
    expect(h.store.uploaded.map((u) => u.rev)).toEqual([1, 2]);
    expect(h.sync.getState().dirty).toBe(false);
  });

  it('flush({force}) uploads the current state even when nothing is marked dirty (what sign-out waits for)', async () => {
    const h = harness();
    expect(await h.sync.flush()).toEqual({ ok: true });
    expect(h.client.saveBackup).not.toHaveBeenCalled(); // clean + not forced: nothing to do
    h.store.current = { rev: 9 };
    expect(await h.sync.flush({ force: true })).toEqual({ ok: true });
    expect(h.store.uploaded).toEqual([{ rev: 9 }]);
  });

  it('without a token the backup stays PENDING (persisted) and no upload is attempted', async () => {
    const h = harness({ ensureToken: async () => null });
    h.sync.markDirty();
    const r = await h.sync.flush();
    expect(r).toEqual({ ok: false, reason: 'auth' });
    expect(h.client.saveBackup).not.toHaveBeenCalled();
    expect(h.sync.getState()).toMatchObject({ status: 'pending', reason: 'auth', dirty: true });
    expect(JSON.parse(h.storage.getItem(BACKUP_STATE_KEY)).dirty).toBe(true);
  });

  it('Drive / network failures keep the change pending with the reason; the next flush retries and clears it', async () => {
    for (const code of ['offline', 'quota', 'auth']) {
      const h = harness({ fail: Object.assign(new Error('x'), { code }) });
      h.sync.markDirty();
      expect(await h.sync.flush()).toEqual({ ok: false, reason: code });
      expect(h.sync.getState()).toMatchObject({ status: 'pending', reason: code, dirty: true });
    }
    const h = harness({ fail: new Error('boom') });
    h.sync.markDirty();
    expect(await h.sync.flush()).toEqual({ ok: false, reason: 'error' });
  });

  it('a pending change survives a restart: the next instance resumes and uploads it', async () => {
    const storage = memStorage();
    const a = harness({ storage, ensureToken: async () => null });
    a.sync.markDirty();
    await a.sync.flush();
    const b = harness({ storage });
    expect(b.sync.getState().dirty).toBe(true);
    b.store.current = { rev: 5 };
    b.sync.resume();
    await b.fire();
    expect(b.store.uploaded).toEqual([{ rev: 5 }]);
    expect(b.sync.getState().dirty).toBe(false);
  });

  it('when backup is not enabled nothing is scheduled (the change is only remembered)', () => {
    const h = harness({ isEnabled: () => false });
    h.sync.markDirty();
    expect(h.timers).toHaveLength(0);
    expect(h.sync.getState().dirty).toBe(true);
  });

  it('background (silent) token attempts are throttled after a failure; an interactive flush ignores the throttle', async () => {
    const ensure = vi.fn(async ({ interactive }) => (interactive ? 'tok-1234567890' : null));
    const h = harness({ ensureToken: ensure });
    h.sync.markDirty();
    await h.sync.flush();
    await h.sync.flush({ force: true });
    expect(ensure).toHaveBeenCalledTimes(1); // second silent attempt skipped
    const r = await h.sync.flush({ force: true, interactive: true });
    expect(r.ok).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('subscribers see syncing -> synced', async () => {
    const h = harness();
    const seen = [];
    h.sync.subscribe((s) => seen.push(s.status));
    h.sync.markDirty();
    await h.sync.flush();
    expect(seen).toContain('syncing');
    expect(seen.at(-1)).toBe('synced');
  });
});
