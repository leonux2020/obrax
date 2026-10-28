// Drive integration, enterprise grade: dedicated app folder, silent token renewal on 401, persistent connection and offline resilience.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDriveClient, BACKUP_FOLDER, LEGACY_BACKUP_FOLDER, BACKUP_FILE } from '../src/lib/drive.js';
import { createDriveSync, backupAge } from '../src/lib/driveSync.js';
import { setDriveToken, getDriveToken, clearDriveToken, DRIVE_TOKEN_KEY } from '../src/lib/driveToken.js';
import { ensureDriveToken, requestDriveAccess, googleConfigStatus, cleanClientId } from '../src/lib/auth.js';
import { createFakeDrive } from './helpers/fakeDrive.js';

const ok = (t) => (t.startsWith('{') ? JSON.parse(t) : null);
const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

describe('1. exclusive app folder "CUBRAX - Respaldos Obra"', () => {
  it('the folder has the exact name and is looked up (mimeType folder) BEFORE anything is saved', async () => {
    expect(BACKUP_FOLDER).toBe('CUBRAX - Respaldos Obra');
    const drive = createFakeDrive();
    await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup('{"v":1}');
    const first = drive.calls[0];
    expect(first.method).toBe('GET');
    const q = new URL(first.url).searchParams.get('q');
    expect(q).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(q).toContain(`name='${BACKUP_FOLDER}'`);
    expect(q).toContain('trashed=false');
  });

  it('when it does not exist it is created in the ROOT of the Drive; the backup lives ONLY inside it (parents)', async () => {
    const drive = createFakeDrive();
    await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup('{"v":1}');
    const [folder] = drive.folders();
    expect(folder.name).toBe(BACKUP_FOLDER);
    expect(folder.parents).toEqual(['root']);
    const create = drive.calls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/drive/v3/files');
    expect(JSON.parse(create.body)).toMatchObject({ name: BACKUP_FOLDER, parents: ['root'] });
    const [file] = drive.backupFiles();
    expect(file.name).toBe(BACKUP_FILE);
    expect(file.parents).toEqual([folder.id]);
    expect(drive.folders()).toHaveLength(1);
  });

  it('an existing folder is reused (no second folder) and parallel saves create it only once', async () => {
    const drive = createFakeDrive();
    const c = () => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
    const shared = c();
    await Promise.all([shared.ensureFolder(), shared.ensureFolder(), shared.ensureFolder()]);
    expect(drive.folders()).toHaveLength(1);
    await c().saveBackup('{"v":2}');
    expect(drive.folders()).toHaveLength(1);
    expect(drive.backupFiles()).toHaveLength(1);
  });

  it('restore reads the backup from the SAME folder', async () => {
    const drive = createFakeDrive();
    const c = () => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
    await c().saveBackup('{"v":9}');
    const got = await c().latestBackup(ok);
    expect(got.value).toEqual({ v: 9 });
    const reads = drive.calls.filter((x) => x.method === 'GET' && new URL(x.url).searchParams.get('q')?.includes(' in parents'));
    expect(reads.length).toBeGreaterThan(0);
  });

  it('the "CUBRAX" folder of the first versions is only READ as a fallback (nothing is written there)', async () => {
    const drive = createFakeDrive();
    const legacy = { id: 'legacyfold1', name: LEGACY_BACKUP_FOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [], body: '', modifiedTime: 5 };
    drive.files.set(legacy.id, legacy);
    drive.files.set('legacyfile1', { id: 'legacyfile1', name: BACKUP_FILE, mimeType: 'application/json', parents: [legacy.id], body: '{"v":"old"}', modifiedTime: 6 });
    const c = () => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
    expect((await c().latestBackup(ok)).value).toEqual({ v: 'old' });
    await c().saveBackup('{"v":"new"}');
    expect(drive.files.get('legacyfile1').body).toBe('{"v":"old"}'); // untouched
    const [mine] = drive.folders().filter((f) => f.name === BACKUP_FOLDER);
    expect(drive.backupFiles().filter((f) => f.parents.includes(mine.id))).toHaveLength(1);
    expect((await c().latestBackup(ok)).value).toEqual({ v: 'new' }); // the app folder wins from now on
  });
});

describe('2. silent token renewal on 401', () => {
  it('an expired token is renewed without any screen and the SAME request is repeated', async () => {
    const drive = createFakeDrive();
    let held = 'tok-expired-000000';
    const refreshToken = vi.fn(async () => {
      held = drive.token;
      return held;
    });
    const rejected = vi.fn();
    const c = createDriveClient({ getToken: async () => held, refreshToken, onAuthRejected: rejected, fetchImpl: drive.fetchImpl });
    await c.saveBackup('{"v":1}');
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledWith('tok-expired-000000');
    expect(drive.backupFiles()[0].body).toBe('{"v":1}');
    await c.saveBackup('{"v":2}'); // the new token is used from now on: no more renewals
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('parallel requests that expire together share ONE renewal', async () => {
    const drive = createFakeDrive();
    let held = 'tok-expired-000000';
    const refreshToken = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      held = drive.token;
      return held;
    });
    const c = createDriveClient({ getToken: async () => held, refreshToken, fetchImpl: drive.fetchImpl });
    await Promise.all([c.findFolder(), c.findFolder(), c.latestBackup(ok)]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('when Google cannot renew silently the error is "auth" (the app then asks once, from a tap)', async () => {
    const drive = createFakeDrive();
    for (const refreshToken of [async () => null, async () => 'tok-expired-000000', async () => { throw new Error('gis'); }]) {
      const c = createDriveClient({ getToken: async () => 'tok-expired-000000', refreshToken, fetchImpl: drive.fetchImpl });
      await expect(c.saveBackup('{}')).rejects.toMatchObject({ code: 'auth', status: 401 });
    }
  });

  it('a renewed token that Drive refuses again does not loop: one retry only', async () => {
    const drive = createFakeDrive();
    const refreshToken = vi.fn(async () => 'tok-also-bad-111111');
    const c = createDriveClient({ getToken: async () => 'tok-expired-000000', refreshToken, fetchImpl: drive.fetchImpl });
    await expect(c.saveBackup('{}')).rejects.toMatchObject({ code: 'auth' });
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(drive.calls.length).toBe(2);
  });

  it('ensureDriveToken: the silent request uses prompt "none" and the account hint, and runs once for concurrent callers', async () => {
    clearDriveToken();
    const request = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      setDriveToken('tok-silent-123456789', 3600, { storage: mem(), linked: mem() });
    });
    const [a, b] = await Promise.all([ensureDriveToken({ request, hint: 'ana@example.com' }), ensureDriveToken({ request, hint: 'ana@example.com' })]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ prompt: 'none', hint: 'ana@example.com' });
    expect(a).toBe('tok-silent-123456789');
    expect(b).toBe(a);
    clearDriveToken({ storage: mem(), persistent: mem() });
  });

  it('a silent request that Google answers with an error or never answers resolves null (never hangs, never throws)', async () => {
    clearDriveToken({ storage: mem(), persistent: mem() });
    expect(await ensureDriveToken({ request: async () => { throw Object.assign(new Error('x'), { code: 'denied' }); } })).toBeNull();
    const gsiNeverAnswers = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    await expect(requestDriveAccess({ enabled: true, load: async () => gsiNeverAnswers, prompt: 'none', silentTimeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('the account hint reaches Google Identity Services', async () => {
    let cfg;
    const gsi = { accounts: { oauth2: { initTokenClient: (c) => ((cfg = c), { requestAccessToken: () => c.callback({ access_token: 'tok-hint-1234567890', expires_in: 3599 }) }) } } };
    await requestDriveAccess({ enabled: true, load: async () => gsi, prompt: 'none', hint: 'ana@example.com' });
    expect(cfg.hint).toBe('ana@example.com');
    clearDriveToken({ storage: mem(), persistent: mem() });
  });
});

describe('persistent connection', () => {
  beforeEach(() => clearDriveToken({ storage: mem(), persistent: mem() }));

  it('a valid token survives closing the PWA (it is also kept outside the session) and dies with its own expiry', () => {
    const session = mem();
    const persistent = mem();
    setDriveToken('tok-persist-123456789', 3600, { storage: session, linked: persistent, now: 1_000 });
    expect(persistent.getItem(DRIVE_TOKEN_KEY)).toContain('tok-persist-123456789');
    clearDriveToken({ storage: mem(), persistent: mem() }); // memory gone, as after a fresh start
    expect(getDriveToken({ storage: mem(), persistent, now: 2_000 })).toBe('tok-persist-123456789'); // new session: read from the persistent copy
    expect(getDriveToken({ storage: mem(), persistent, now: 1_000 + 3600_000 })).toBeNull(); // expired
    expect(persistent.getItem(DRIVE_TOKEN_KEY)).toBeNull(); // and erased
  });

  it('a refused (401) token is erased everywhere and the device stays "linked" for silent renewals', () => {
    const session = mem();
    const persistent = mem();
    setDriveToken('tok-persist-123456789', 3600, { storage: session, linked: persistent });
    clearDriveToken({ storage: session, persistent });
    expect(session.getItem(DRIVE_TOKEN_KEY)).toBeNull();
    expect(persistent.getItem(DRIVE_TOKEN_KEY)).toBeNull();
    expect(persistent.getItem('cp.drive.linked.v1')).toBe('1');
  });
});

describe('3. offline resilience of the sync engine', () => {
  const build = (online) => {
    const store = mem();
    const client = { saveBackup: vi.fn(async () => ({ id: 'x' })) };
    const state = { online };
    const sync = createDriveSync({ client, collect: async () => ({ rev: 1 }), ensureToken: vi.fn(async () => 'tok-1234567890'), storage: store, isOnline: () => state.online, setTimer: () => 1, clearTimer: () => {} });
    return { sync, client, state };
  };

  it('without coverage nothing is sent: pending/offline, no crash, change kept', async () => {
    const { sync, client } = build(false);
    sync.markDirty();
    const r = await sync.flush({ force: true, interactive: true });
    expect(r).toEqual({ ok: false, reason: 'offline' });
    expect(client.saveBackup).not.toHaveBeenCalled();
    expect(sync.getState()).toMatchObject({ status: 'pending', reason: 'offline', dirty: true });
  });

  it('when the signal returns retryNow uploads what was pending, and does nothing when nothing is pending', async () => {
    const { sync, client, state } = build(false);
    expect(await sync.retryNow()).toEqual({ ok: true });
    sync.markDirty();
    await sync.flush();
    state.online = true;
    const r = await sync.retryNow();
    expect(r.ok).toBe(true);
    expect(client.saveBackup).toHaveBeenCalledTimes(1);
    expect(sync.getState()).toMatchObject({ status: 'synced', dirty: false });
  });

  it('a network failure in the middle of the upload is classified offline too (fetch throws)', async () => {
    const drive = createFakeDrive();
    drive.state.offline = true;
    const sync = createDriveSync({
      client: createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }),
      collect: async () => ({ rev: 1 }),
      ensureToken: async () => drive.token,
      storage: mem(),
      isOnline: () => true,
      setTimer: () => 1,
      clearTimer: () => {},
    });
    sync.markDirty();
    expect(await sync.flush({ force: true })).toEqual({ ok: false, reason: 'offline' });
    drive.state.offline = false;
    expect((await sync.retryNow()).ok).toBe(true);
    expect(drive.backupFiles()).toHaveLength(1);
  });
});

describe('6. VITE_GOOGLE_CLIENT_ID: reading and diagnosis', () => {
  const GOOD = 'abc-123.apps.googleusercontent.com';
  it('absent, empty, "undefined" or whitespace -> missing (the admin diagnostic); a real client id -> ok', () => {
    for (const v of [undefined, null, '', '   ', 'undefined', 'null', '""', "''"]) expect(googleConfigStatus(v)).toBe('missing');
    expect(googleConfigStatus(GOOD)).toBe('ok');
  });
  it('quotes and spaces pasted into the Vercel panel are tolerated; a value that is not a client id is "invalid"', () => {
    expect(cleanClientId(`  "${GOOD}"  `)).toBe(GOOD);
    expect(googleConfigStatus(`'${GOOD}'\n`)).toBe('ok');
    expect(googleConfigStatus('my-secret-key')).toBe('invalid');
    expect(googleConfigStatus('abc.apps.googleusercontent.com.evil.com')).toBe('invalid');
  });
  it('the last backup reads "Hace un momento" / minutes / hours / days and never goes negative', () => {
    const now = 1_000_000_000_000;
    expect(backupAge(0, now)).toBeNull();
    expect(backupAge(now - 5_000, now)).toEqual({ key: 'backup.ago.now', n: 0 });
    expect(backupAge(now + 60_000, now)).toEqual({ key: 'backup.ago.now', n: 0 });
    expect(backupAge(now - 5 * 60_000, now)).toEqual({ key: 'backup.ago.min', n: 5 });
    expect(backupAge(now - 3 * 3_600_000, now)).toEqual({ key: 'backup.ago.hour', n: 3 });
    expect(backupAge(now - 2 * 86_400_000, now)).toEqual({ key: 'backup.ago.day', n: 2 });
  });
});
