import { describe, it, expect, vi } from 'vitest';
import { createDriveClient, DriveError, BACKUP_FILE, BACKUP_FOLDER } from '../src/lib/drive.js';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CSP_DIRECTIVES } from '../security/policy.js';

const make = (drive, opts = {}) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl, ...opts });
const ok = (t) => (t.startsWith('{') ? JSON.parse(t) : null);

describe('Drive client: one CUBRAX folder, one backup file', () => {
  it('the first save creates the CUBRAX folder and the file inside it', async () => {
    const drive = createFakeDrive();
    await make(drive).saveBackup('{"v":1}');
    expect(drive.folders().map((f) => f.name)).toEqual([BACKUP_FOLDER]);
    const [file] = drive.backupFiles();
    expect(file.name).toBe(BACKUP_FILE);
    expect(file.parents).toEqual([drive.folders()[0].id]);
    expect(file.body).toBe('{"v":1}');
  });

  it('later saves overwrite the same file (no duplicates, no new folder), also from a fresh client', async () => {
    const drive = createFakeDrive();
    await make(drive).saveBackup('{"v":1}');
    await make(drive).saveBackup('{"v":2}');
    await make(drive).saveBackup('{"v":3}');
    expect(drive.folders()).toHaveLength(1);
    expect(drive.backupFiles()).toHaveLength(1);
    expect(drive.backupFiles()[0].body).toBe('{"v":3}');
  });

  it('reads the latest backup; with nothing in Drive it returns null and creates nothing', async () => {
    const drive = createFakeDrive();
    expect(await make(drive).latestBackup(ok)).toBeNull();
    expect(drive.files.size).toBe(0);
    await make(drive).saveBackup('{"v":7}');
    expect((await make(drive).latestBackup(ok)).value).toEqual({ v: 7 });
  });

  it('a damaged newest file falls back to the previous valid one', async () => {
    const drive = createFakeDrive();
    const c = make(drive);
    await c.saveBackup('{"v":1}');
    const folder = drive.folders()[0];
    // a newer corrupt copy named like the backup
        drive.files.set('newerxxxx2', { id: 'newerxxxx2', name: BACKUP_FILE, mimeType: 'application/json', parents: [folder.id], body: 'not json', modifiedTime: 99_999 });
    const got = await make(drive).latestBackup(ok);
    expect(got.value).toEqual({ v: 1 }); // skipped the corrupt newest file, then the older "v: older" never needed
  });

  it('errors are classified: no token / rejected token / offline / quota', async () => {
    const drive = createFakeDrive();
    await expect(createDriveClient({ getToken: async () => null, fetchImpl: drive.fetchImpl }).saveBackup('{}')).rejects.toMatchObject({ code: 'auth' });

    const rejected = vi.fn();
    const bad = createDriveClient({ getToken: async () => 'tok-wrong-123456', fetchImpl: drive.fetchImpl, onAuthRejected: rejected });
    await expect(bad.saveBackup('{}')).rejects.toBeInstanceOf(DriveError);
    expect(rejected).toHaveBeenCalledTimes(1);

    drive.state.offline = true;
    await expect(make(drive).saveBackup('{}')).rejects.toMatchObject({ code: 'offline' });
    drive.state.offline = false;
    drive.state.failNext = 1;
    drive.state.status = 403;
    await expect(make(drive).saveBackup('{}')).rejects.toMatchObject({ code: 'quota' });
  });

  it('a folder or file deleted from Drive while the app is open is looked up again once', async () => {
    const drive = createFakeDrive();
    const c = make(drive);
    await c.saveBackup('{"v":1}');
    drive.files.clear(); // the user emptied their Drive
    await c.saveBackup('{"v":2}');
    expect(drive.folders()).toHaveLength(1);
    expect(drive.backupFiles()[0].body).toBe('{"v":2}');
  });

  it('only ever asks for the files it created (queries are scoped to the CUBRAX folder / names)', async () => {
    const drive = createFakeDrive();
    await make(drive).saveBackup('{}');
    const queries = drive.calls.filter((c) => c.method === 'GET').map((c) => new URL(c.url).searchParams.get('q'));
    expect(queries.every((q) => q.includes(`name='${BACKUP_FOLDER}'`) || q.includes(`name='${BACKUP_FILE}'`))).toBe(true);
  });

  it('every URL the client calls is allowed by the app Content-Security-Policy (connect-src)', async () => {
    const drive = createFakeDrive();
    const c = make(drive);
    await c.saveBackup('{"v":1}');
    await c.saveBackup('{"v":2}');
    await c.latestBackup(ok);
    const allowed = CSP_DIRECTIVES['connect-src'].filter((x) => x.startsWith('https://'));
    expect(drive.calls.length).toBeGreaterThan(4);
    for (const call of drive.calls) expect(allowed.some((a) => call.url.startsWith(a)), call.url).toBe(true);
  });
});
