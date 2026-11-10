// @vitest-environment happy-dom
// The silent concierge of the Drive (driveSanitizer.js) + atomic creation (drive.js): "Mi unidad" ends up clean by itself, nothing is ever deleted for good,
// and nothing here can break the app.
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { createDriveClient, BACKUP_FILE } from '../src/lib/drive.js';
import { GLOBAL_WORDS, RENDITION_PREFIXES, TIDY, TIDY_KEY, classifySheet, projectCandidates, sanitizeDrive, scheduleSanitize } from '../src/lib/driveSanitizer.js';
import { fileStem } from '../src/lib/sheetData.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { createFakeDrive } from './helpers/fakeDrive.js';

const SHEET = 'application/vnd.google-apps.spreadsheet';
const make = (drive, opts = {}) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl, ...opts });
const backups = (drive) => drive.backupFiles().filter((f) => f.name === BACKUP_FILE);
const sheetsNamed = (drive, name) => drive.spreadsheets().filter((f) => f.name === name);
const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

describe('1. creation is atomic: the backup is born INSIDE the CUBRAX folder', () => {
  it('the multipart POST carries `parents: [folder]` in its first part; nothing is created in the root and nothing is moved afterwards', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    await client.saveBackup('{"v":1}');
    const [folder] = drive.folders();
    const post = drive.calls.find((c) => c.method === 'POST' && c.url.includes('uploadType=multipart'));
    const meta = JSON.parse(post.body.split('\r\n\r\n')[1].split('\r\n--')[0]);
    expect(meta).toMatchObject({ name: BACKUP_FILE, parents: [folder.id] });
    expect(backups(drive)[0].parents).toEqual([folder.id]);
    expect(drive.calls.some((c) => c.method === 'PATCH' && c.url.includes('addParents'))).toBe(false); // no "create in the root, move later"
    await client.saveBackup('{"v":2}'); // the next ones update the same file
    await client.saveBackup('{"v":3}');
    expect(backups(drive)).toHaveLength(1);
    expect(backups(drive)[0].parents).toEqual([folder.id]);
  });

  it('two saves at the same time never leave two files (the client runs them one after the other)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    await Promise.all([client.saveBackup('{"v":1}'), client.saveBackup('{"v":2}'), client.saveBackup('{"v":3}')]);
    expect(backups(drive)).toHaveLength(1);
    expect(backups(drive)[0].body).toBe('{"v":3}');
  });

  it('a failed save does not block the next one', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    drive.state.failNext = 1;
    await expect(client.saveBackup('{"v":1}')).rejects.toBeTruthy();
    await expect(client.saveBackup('{"v":2}')).resolves.toBeTruthy();
    expect(backups(drive)).toHaveLength(1);
  });
});

describe('2. MISSION A: one backup, the newest, inside the master folder; the others to the trash', () => {
  it('the newest is already in the folder: the stray old copies (root, legacy folder) go to the trash and nothing else moves', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    const legacy = drive.seed({ name: 'CUBRAX', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
    drive.seed({ id: 'goodnew001', name: BACKUP_FILE, parents: [master], body: '{"v":3}', modifiedTime: 3000 });
    drive.seed({ id: 'oldroot001', name: BACKUP_FILE, parents: ['root'], body: '{"v":1}', modifiedTime: 1000 });
    drive.seed({ id: 'oldlegacy1', name: BACKUP_FILE, parents: [legacy.id], body: '{"v":2}', modifiedTime: 2000 });
    const r = await sanitizeDrive(client);
    expect(r).toMatchObject({ ok: true, backup: { kept: 'goodnew001', moved: 0, trashed: 2 } });
    expect(backups(drive).map((f) => f.id)).toEqual(['goodnew001']);
    expect(drive.trashed().map((f) => f.id).sort()).toEqual(['oldlegacy1', 'oldroot001']);
    expect(drive.files.get('goodnew001').parents).toEqual([master]);
  });

  it('the newest sits in the ROOT: it is moved into the folder (addParents / removeParents) and the older one in the folder is trashed', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'inside0001', name: BACKUP_FILE, parents: [master], body: '{"v":1}', modifiedTime: 1000 });
    drive.seed({ id: 'rootnew001', name: BACKUP_FILE, parents: ['root'], body: '{"v":2}', modifiedTime: 5000 });
    const r = await sanitizeDrive(client);
    expect(r.ok).toBe(true);
    expect(r.backup).toMatchObject({ kept: 'rootnew001', moved: 1, trashed: 1 });
    expect(drive.files.get('rootnew001').parents).toEqual([master]);
    expect(drive.files.get('inside0001').trashed).toBe(true);
    const move = drive.calls.find((c) => c.method === 'PATCH' && c.url.includes('addParents'));
    expect(new URL(move.url).searchParams.get('addParents')).toBe(master);
    expect(new URL(move.url).searchParams.get('removeParents')).toBe('root');
    const trash = drive.calls.find((c) => c.method === 'PATCH' && c.body === JSON.stringify({ trashed: true }));
    expect(trash.url).toContain('/files/inside0001');
  });

  it('with no master folder yet, the lone backup of the root is brought into one (created for it)', async () => {
    const drive = createFakeDrive();
    drive.seed({ id: 'rootonly01', name: BACKUP_FILE, parents: ['root'], body: '{"v":1}', modifiedTime: 100 });
    const client = make(drive);
    expect((await sanitizeDrive(client)).ok).toBe(true);
    const [folder] = drive.folders();
    expect(folder.name).toBe('CUBRAX - Respaldos Obra');
    expect(drive.files.get('rootonly01').parents).toEqual([folder.id]);
  });

  it('a clean Drive costs nothing: no folder is created, nothing is moved or trashed', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    await client.saveBackup('{"v":1}');
    drive.calls.length = 0;
    const r = await sanitizeDrive(client);
    expect(r.ok).toBe(true);
    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    const empty = createFakeDrive();
    expect((await sanitizeDrive(make(empty))).ok).toBe(true);
    expect(empty.folders()).toHaveLength(0);
  });

  it('the newest looks EMPTY: it is put in place but nothing is trashed (the older one may be the only good copy)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'emptynew01', name: BACKUP_FILE, parents: ['root'], body: '', modifiedTime: 9000 });
    drive.seed({ id: 'goodolder1', name: BACKUP_FILE, parents: [master], body: '{"v":1}', modifiedTime: 1000 });
    const r = await sanitizeDrive(client);
    expect(r.backup.trashed).toBe(0);
    expect(drive.trashed()).toHaveLength(0);
  });

  it('a file already in the trash is not a candidate; only OWN files are asked for', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'inside0001', name: BACKUP_FILE, parents: [master], body: '{"v":1}', modifiedTime: 1000 });
    drive.seed({ id: 'deadtrash1', name: BACKUP_FILE, parents: ['root'], body: '{"v":0}', modifiedTime: 9000 }).trashed = true;
    await sanitizeDrive(client);
    expect(drive.files.get('inside0001').trashed).toBeUndefined(); // the trashed "newer" one did not win
    for (const c of drive.calls.filter((x) => x.url.includes('/drive/v3/files?'))) {
      const q = new URL(c.url).searchParams.get('q') || '';
      if (q.includes(BACKUP_FILE) || q.includes(SHEET) || q.includes('in parents')) {
        expect(q, q).toContain('trashed=false');
        if (q.includes(BACKUP_FILE) && q.includes('mimeType!=')) expect(q).toContain("'me' in owners");
      }
    }
  });

  it('NOTHING is ever deleted for good: the only writes are moves and PATCH {trashed:true}', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'inside0001', name: BACKUP_FILE, parents: [master], modifiedTime: 1000, body: '{"v":1}' });
    drive.seed({ id: 'rootnew001', name: BACKUP_FILE, parents: ['root'], modifiedTime: 2000, body: '{"v":2}' });
    drive.seed({ id: 'orphan0001', name: 'rendicion-Casa', mimeType: SHEET, parents: ['root'], modifiedTime: 3000 });
    await sanitizeDrive(client, { projectNames: () => ['Casa'] });
    expect(drive.calls.some((c) => c.method === 'DELETE')).toBe(false);
    for (const c of drive.calls.filter((x) => x.method === 'PATCH')) expect(c.body === JSON.stringify({ trashed: true }) || c.body === '{}').toBe(true);
  });
});

describe('3. MISSION B: the Sheets of the rendición lying in the root', () => {
  it('classifySheet: rendicion-<obra> in any language, the consolidated one, a stranger is left alone', () => {
    const c = projectCandidates(['Casa Norte', 'Casa'], []);
    expect(classifySheet('rendicion-Casa-Norte', c)).toMatchObject({ kind: 'project', candidate: { name: 'Casa Norte' } });
    expect(classifySheet('rendicion-Casa', c)).toMatchObject({ kind: 'project', candidate: { name: 'Casa' } }); // exact stem: not the longer one
    expect(classifySheet('Statement-casa', c)).toMatchObject({ kind: 'project', candidate: { name: 'Casa' } });
    expect(classifySheet('rendicion-consolidado', c)).toEqual({ kind: 'global' });
    expect(classifySheet('abrechnung-konsolidiert', c)).toEqual({ kind: 'global' });
    expect(classifySheet('rendicion-Otra-Obra', c)).toEqual({ kind: 'unknown' });
    for (const stranger of ['Presupuesto 2026', 'rendicion', 'rendicion-', 'mi-hoja', '', null, undefined, 42]) expect(classifySheet(stranger, c), String(stranger)).toBeNull();
  });

  it('the prefixes and the "consolidated" words are the ones of the six dictionaries', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const { t } = makeI18n(lang, 'CL');
      expect(RENDITION_PREFIXES, lang).toContain(fileStem(t('xl.file.prefix'), 'rendicion'));
      expect(GLOBAL_WORDS, lang).toContain(fileStem(t('xl.file.global'), 'global'));
    }
  });

  it('an orphan goes to the folder of its project (found in Drive by its name)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await client.ensureFolderPath(['Proyectos', 'Casa Norte']);
    drive.seed({ id: 'orphan0001', name: 'rendicion-Casa-Norte', mimeType: SHEET, parents: ['root'], modifiedTime: 100 });
    const r = await sanitizeDrive(client);
    expect(r).toMatchObject({ ok: true, sheets: { moved: 1, trashed: 0 } });
    expect(drive.files.get('orphan0001').parents).toEqual([folder]);
    expect(drive.folders().filter((f) => f.name === 'Casa Norte')).toHaveLength(1); // no second folder
  });

  it('the project folder does not exist yet: it is created (with the REAL name the app knows) and the Sheet goes in', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    await client.ensureFolder();
    drive.seed({ id: 'orphan0001', name: 'rendicion-Casa-Norte', mimeType: SHEET, parents: ['root'], modifiedTime: 100 });
    const r = await sanitizeDrive(client, { projectNames: () => ['Casa Norte', 'Otra'] });
    expect(r.sheets.moved).toBe(1);
    const proj = drive.folders().find((f) => f.name === 'Casa Norte');
    expect(proj).toBeTruthy();
    expect(drive.files.get('orphan0001').parents).toEqual([proj.id]);
    // the app's next export finds it in the folder: no second Sheet
    const folderId = await client.ensureFolderPath(['Proyectos', 'Casa Norte']);
    expect(folderId).toBe(proj.id);
    const out = await client.upsertSpreadsheet(folderId, { title: 'rendicion-Casa-Norte', sheets: [{ name: 'Resumen', rows: [['a']] }] });
    expect(out).toMatchObject({ id: 'orphan0001', created: false });
  });

  it('HIGHLANDER: the orphan is newer than the Sheet in the folder -> it takes its place and the old one goes to the trash', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await client.ensureFolderPath(['Proyectos', 'Casa']);
    drive.seed({ id: 'inplace001', name: 'rendicion-Casa', mimeType: SHEET, parents: [folder], modifiedTime: 1000 });
    drive.seed({ id: 'orphan0001', name: 'rendicion-Casa', mimeType: SHEET, parents: ['root'], modifiedTime: 5000 });
    const r = await sanitizeDrive(client);
    expect(r.sheets).toMatchObject({ moved: 1, trashed: 1 });
    expect(drive.files.get('orphan0001').parents).toEqual([folder]);
    expect(drive.files.get('inplace001').trashed).toBe(true);
    expect(sheetsNamed(drive, 'rendicion-Casa')).toHaveLength(1);
  });

  it('HIGHLANDER: the Sheet in the folder is newer -> the orphan is the old copy and goes to the trash (it is not moved)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await client.ensureFolderPath(['Proyectos', 'Casa']);
    drive.seed({ id: 'inplace001', name: 'rendicion-Casa', mimeType: SHEET, parents: [folder], modifiedTime: 9000 });
    drive.seed({ id: 'orphan0001', name: 'rendicion-Casa', mimeType: SHEET, parents: ['root'], modifiedTime: 100 });
    const r = await sanitizeDrive(client);
    expect(r.sheets).toMatchObject({ moved: 0, trashed: 1 });
    expect(drive.files.get('orphan0001').trashed).toBe(true);
    expect(drive.files.get('inplace001').trashed).toBeUndefined();
    expect(drive.files.get('inplace001').parents).toEqual([folder]);
  });

  it('several orphans with the same name: the most recent one stays, the rest are trashed', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    await client.ensureFolder();
    drive.seed({ id: 'orphanold1', name: 'rendicion-Casa', mimeType: SHEET, parents: ['root'], modifiedTime: 100 });
    drive.seed({ id: 'orphannew1', name: 'rendicion-Casa', mimeType: SHEET, parents: ['root'], modifiedTime: 900 });
    drive.seed({ id: 'orphanmid1', name: 'rendicion-Casa', mimeType: SHEET, parents: ['root'], modifiedTime: 500 });
    const r = await sanitizeDrive(client, { projectNames: () => ['Casa'] });
    expect(r.ok).toBe(true);
    expect(sheetsNamed(drive, 'rendicion-Casa').map((f) => f.id)).toEqual(['orphannew1']);
    expect(drive.files.get('orphannew1').parents).not.toContain('root');
  });

  it('the consolidated rendición goes to Rendiciones_Globales; a project nobody knows goes to the master folder (out of the root, not lost)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'orphanglob', name: 'rendicion-consolidado', mimeType: SHEET, parents: ['root'], modifiedTime: 200 });
    drive.seed({ id: 'orphanlost', name: 'rendicion-Obra-Borrada', mimeType: SHEET, parents: ['root'], modifiedTime: 100 });
    const r = await sanitizeDrive(client);
    expect(r.sheets).toMatchObject({ moved: 2, unknown: 1 });
    const globals = drive.folders().find((f) => f.name === 'Rendiciones_Globales');
    expect(drive.files.get('orphanglob').parents).toEqual([globals.id]);
    expect(globals.parents).toEqual([master]);
    expect(drive.files.get('orphanlost').parents).toEqual([master]);
  });

  it('a Sheet that is not ours is left exactly where it is', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    drive.seed({ id: 'stranger01', name: 'Presupuesto familiar', mimeType: SHEET, parents: ['root'], modifiedTime: 100 });
    const r = await sanitizeDrive(client);
    expect(r.sheets).toMatchObject({ moved: 0, trashed: 0, left: 1 });
    expect(drive.files.get('stranger01').parents).toEqual(['root']);
    expect(drive.files.get('stranger01').trashed).toBeUndefined();
  });

  it('projectCandidates: a folder already in Drive wins over the same name from the app; empty / odd names are skipped', () => {
    const c = projectCandidates(['Casa Norte', '', null, 7, '???'], [{ id: 'fld1xxxxxx', name: 'Casa Norte' }]);
    expect(c).toEqual([{ name: 'Casa Norte', stem: 'Casa-Norte', id: 'fld1xxxxxx' }]);
  });
});

describe('4. ZERO-STRESS: it never throws, never blocks, never fights the sync', () => {
  const trouble = async (setup, expectCode) => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'old0000001', name: BACKUP_FILE, parents: ['root'], body: '{"v":1}', modifiedTime: 1 });
    drive.seed({ id: 'new0000001', name: BACKUP_FILE, parents: [master], body: '{"v":2}', modifiedTime: 2 });
    setup(drive);
    const r = await sanitizeDrive(client);
    return { r, drive, expectCode };
  };

  it('no connection: resolves with ok:false (nothing thrown), and the files are untouched', async () => {
    const { r, drive } = await trouble((d) => { d.state.offline = true; });
    expect(r.ok).toBe(false);
    expect(r.stopped).toBe(true);
    expect(drive.trashed()).toHaveLength(0);
  });

  it('a rejected token (401) or missing permissions (403): silent, ok:false, stops at the first problem', async () => {
    const stale = createFakeDrive();
    const old = stale.token;
    const expired = createDriveClient({ getToken: async () => old, fetchImpl: stale.fetchImpl });
    stale.rotate('another-token-999'); // Drive no longer accepts the token this client holds
    await expect(sanitizeDrive(expired)).resolves.toMatchObject({ ok: false, stopped: true });
    const drive = createFakeDrive();
    const client = make(drive);
    drive.state.failNext = 99;
    drive.state.status = 403;
    await expect(sanitizeDrive(client)).resolves.toMatchObject({ ok: false });
  });

  it('a 500 in the middle: the concierge reports it and carries on with what it can; never rejects', async () => {
    const { r, drive } = await trouble((d) => { d.state.failNext = 1; d.state.status = 500; });
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.errors)).toBe(true);
    expect(drive.files.get('new0000001').trashed).toBeUndefined(); // the newest is never the one that goes
  });

  it('garbage in: no client, a client without the primitives, projectNames that throws or returns junk', async () => {
    await expect(sanitizeDrive(null)).resolves.toMatchObject({ ok: false });
    await expect(sanitizeDrive({})).resolves.toMatchObject({ ok: false });
    await expect(sanitizeDrive(undefined, undefined)).resolves.toMatchObject({ ok: false });
    const drive = createFakeDrive();
    const client = make(drive);
    await expect(sanitizeDrive(client, { projectNames: () => { throw new Error('x'); } })).resolves.toMatchObject({ ok: true });
    await expect(sanitizeDrive(client, { projectNames: () => 'nope' })).resolves.toMatchObject({ ok: true });
    await expect(sanitizeDrive({ findBackups: async () => { throw new Error('boom'); } })).resolves.toMatchObject({ ok: false });
  });

  it('a client that throws synchronously cannot escape either', async () => {
    const client = { findBackups: () => { throw new TypeError('sync'); }, listSheets: () => { throw new TypeError('sync'); }, serial: (fn) => fn() };
    await expect(sanitizeDrive(client)).resolves.toMatchObject({ ok: false });
  });

  it('it runs through client.serial: a backup being saved and the tidy-up never interleave, and the fresh backup is the one that stays', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    drive.seed({ id: 'oldroot001', name: BACKUP_FILE, parents: ['root'], body: '{"v":0}', modifiedTime: 1 });
    const [saved, report] = await Promise.all([client.saveBackup('{"v":9}'), sanitizeDrive(client)]);
    expect(saved.id).toBeTruthy();
    expect(report.ok).toBe(true);
    expect(backups(drive)).toHaveLength(1);
    expect(backups(drive)[0].body).toBe('{"v":9}');
    expect(drive.files.get('oldroot001').trashed).toBe(true);
  });

  it('it is bounded per run (40 mutations); the next run carries on until the Drive is tidy', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'keepernew1', name: BACKUP_FILE, parents: [master], body: '{"v":1}', modifiedTime: 99_999 });
    for (let i = 0; i < 70; i += 1) drive.seed({ id: `stale${String(i).padStart(5, '0')}`, name: BACKUP_FILE, parents: ['root'], body: '{"v":0}', modifiedTime: 1000 + i });
    const first = await sanitizeDrive(client);
    expect(first.backup.trashed).toBe(TIDY.maxMutations);
    expect(backups(drive).length).toBe(1 + 70 - TIDY.maxMutations);
    await sanitizeDrive(client);
    expect(backups(drive).map((f) => f.id)).toEqual(['keepernew1']);
  });

  it('it is idempotent: a second run over a tidy Drive changes nothing', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const master = await client.ensureFolder();
    drive.seed({ id: 'old0000001', name: BACKUP_FILE, parents: ['root'], body: '{"v":1}', modifiedTime: 1 });
    drive.seed({ id: 'new0000001', name: BACKUP_FILE, parents: [master], body: '{"v":2}', modifiedTime: 2 });
    await sanitizeDrive(client);
    drive.calls.length = 0;
    const again = await sanitizeDrive(client);
    expect(again.ok).toBe(true);
    expect(drive.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('5. the background entry: deferred, throttled, retried only when it did not finish', () => {
  it('returns at once (the work is handed to the idle scheduler), and marks the day only after a clean run', async () => {
    const storage = mem();
    const queue = [];
    const sanitize = vi.fn(async () => ({ ok: true }));
    expect(scheduleSanitize({}, { storage, now: () => 1_000_000, run: (fn) => queue.push(fn), sanitize })).toBe(true);
    expect(sanitize).not.toHaveBeenCalled(); // nothing ran inside the call: the UI is never held
    expect(storage.getItem(TIDY_KEY)).toBeNull();
    await queue[0]();
    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(storage.getItem(TIDY_KEY)).toBe('1000000');
  });

  it('not twice within 12 h; again after', () => {
    const storage = mem();
    storage.setItem(TIDY_KEY, '1000000');
    const run = vi.fn();
    expect(scheduleSanitize({}, { storage, now: () => 1_000_000 + TIDY.everyMs - 1, run })).toBe(false);
    expect(scheduleSanitize({}, { storage, now: () => 1_000_000 + TIDY.everyMs, run })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a run that was stopped (network / permissions) is NOT marked: it will be tried at the next sync', async () => {
    const storage = mem();
    const queue = [];
    scheduleSanitize({}, { storage, now: () => 5, run: (fn) => queue.push(fn), sanitize: async () => ({ ok: false, stopped: true }) });
    await queue[0]();
    expect(storage.getItem(TIDY_KEY)).toBeNull();
  });

  it('a blocked storage or a throwing scheduler does not break anything', async () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(scheduleSanitize({}, { storage: broken, run: () => {} })).toBe(false);
    const queue = [];
    expect(scheduleSanitize({}, { storage: { getItem: () => null, setItem: () => { throw new Error('full'); } }, run: (fn) => queue.push(fn), sanitize: async () => ({ ok: true }) })).toBe(true);
    await expect(queue[0]()).resolves.toBeUndefined();
  });

  it('the app starts it after the FIRST good sync of the session (status "synced"), without awaiting it', () => {
    const app = fs.readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8');
    expect(app).toMatch(/import \{ scheduleSanitize \} from '\.\/lib\/driveSanitizer\.js'/);
    expect(app).toMatch(/st\.status !== 'synced' \|\| tidyAsked\.current/);
    expect(app).toMatch(/scheduleSanitize\(driveClient, \{ projectNames/);
    expect(app).not.toMatch(/await scheduleSanitize/);
  });
});
