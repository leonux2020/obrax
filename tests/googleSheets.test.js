// @vitest-environment happy-dom
// The rendición as a LIVE Google Sheet (Sheets API v4): the client (drive.js upsertSpreadsheet), the scopes, the CSP, the dossier, the export sheet and
// the end of the hand-made .xlsx. Everything runs against the in-memory Drive + Sheets of tests/helpers/fakeDrive.js.
import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { createDriveClient, DriveError } from '../src/lib/drive.js';
import { DRIVE_FILE_SCOPE, DRIVE_SCOPE, DRIVE_SCOPES, SHEETS_SCOPE } from '../src/lib/auth.js';
import { CSP_DIRECTIVES } from '../security/policy.js';
import { syncDossier } from '../src/lib/driveExport.js';
import { runExport } from '../src/lib/exportActions.js';
import { createFakeDrive } from './helpers/fakeDrive.js';

const make = (drive, opts = {}) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl, ...opts });
const SH = (note = 'x') => [
  { name: 'Resumen', rows: [['Total', 100], [note]] },
  { name: 'Gastos', rows: [['Fecha', 'Monto'], ['2026-10-02', 30000]] },
];
const folderOf = async (client) => client.ensureFolderPath(['Proyectos', 'Casa']);
const urls = (drive) => drive.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);

describe('1. OAuth scopes', () => {
  it('drive.file (folders, PDFs, photos, the move) + spreadsheets (the Sheets API), as one space-separated request', () => {
    expect(DRIVE_FILE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(SHEETS_SCOPE).toBe('https://www.googleapis.com/auth/spreadsheets');
    expect(DRIVE_SCOPES).toEqual([DRIVE_FILE_SCOPE, SHEETS_SCOPE]);
    expect(DRIVE_SCOPE).toBe(`${DRIVE_FILE_SCOPE} ${SHEETS_SCOPE}`);
  });

  it('a Google answer that did not grant BOTH scopes is not a connection', async () => {
    const { requestDriveAccess } = await import('../src/lib/auth.js');
    let asked = null;
    const gsi = (granted) => ({
      accounts: {
        oauth2: {
          hasGrantedAllScopes: (_resp, ...scopes) => {
            asked = scopes;
            return granted;
          },
          initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: 'tok', expires_in: 3600 }) }),
        },
      },
    });
    await expect(requestDriveAccess({ enabled: true, load: async () => gsi(true) })).resolves.toEqual({ granted: true });
    expect(asked).toEqual([DRIVE_FILE_SCOPE, SHEETS_SCOPE]);
    await expect(requestDriveAccess({ enabled: true, load: async () => gsi(false) })).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('2. Create: POST spreadsheets (tabs in the same request) -> move into the folder -> values:batchUpdate RAW', () => {
  it('the exact call sequence, the tabs and the values', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    drive.calls.length = 0;
    const out = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH() });
    expect(out.created).toBe(true);
    // lookup in the folder, lookup of an orphan in the root, create, read parents, move, write the data, and (nice-to-have) the visual design AFTER the data
    expect(urls(drive)).toEqual([
      'GET /drive/v3/files',
      'GET /drive/v3/files',
      'POST /v4/spreadsheets',
      `GET /drive/v3/files/${out.id}`,
      `PATCH /drive/v3/files/${out.id}`,
      `POST /v4/spreadsheets/${out.id}/values:batchUpdate`,
      `POST /v4/spreadsheets/${out.id}:batchUpdate`,
    ]);
    const create = JSON.parse(drive.calls[2].body);
    expect(create.properties.title).toBe('rendicion-Casa');
    expect(create.sheets.map((s) => s.properties.title)).toEqual(['Resumen', 'Gastos']);
    const write = JSON.parse(drive.calls[5].body);
    expect(write.valueInputOption).toBe('RAW');
    expect(write.data.map((d) => d.range)).toEqual(["'Resumen'!A1", "'Gastos'!A1"]);
    expect(write.data.every((d) => d.majorDimension === 'ROWS')).toBe(true);
    const sheet = drive.sheet('rendicion-Casa');
    expect(sheet.parents).toEqual([folder]); // out of the root, into "Proyectos / Casa"
    expect(sheet.tabs).toEqual({ Resumen: [['Total', 100], ['x']], Gastos: [['Fecha', 'Monto'], ['2026-10-02', 30000]] });
    expect(drive.calls.every((c) => c.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets') || c.url.startsWith('https://www.googleapis.com/drive/v3/'))).toBe(true);
  });

  it('only pure values leave the device: style objects, NaN, null and "=" text are sent as plain RAW values', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 't', sheets: [{ name: 'S', rows: [[{ v: 'Total', bold: true, head: true }, { v: 5, money: true }, NaN, null, undefined, '=1+1', 'ok']] }] });
    const body = drive.calls.find((c) => c.url.includes('values:batchUpdate')).body;
    expect(body).not.toMatch(/bold|head|money|NaN|null/);
    expect(drive.sheet('t').tabs.S).toEqual([['Total', 5, '', '', '', '=1+1', 'ok']].map((r) => r.slice(0, 7)));
    expect(JSON.parse(body).valueInputOption).toBe('RAW'); // RAW: "=1+1" stays text, it is never a formula
  });

  it('a long list (more rows than the default 1000-row grid of a new tab) is written: the grid is sized for the data', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    const rows = Array.from({ length: 2300 }, (_, i) => [`G${i}`, i]);
    await client.upsertSpreadsheet(folder, { title: 'big', sheets: [{ name: 'Gastos', rows }] });
    const sheet = drive.sheet('big');
    expect(sheet.tabs.Gastos).toHaveLength(2300);
    expect(sheet.tabs.Gastos[2299]).toEqual(['G2299', 2299]);
    expect(sheet.grids[0].rowCount).toBeGreaterThanOrEqual(2350);
    // the data goes in bounded ranges, never one giant request
    const writes = drive.calls.filter((c) => c.url.includes('values:batchUpdate')).map((c) => JSON.parse(c.body));
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes.flatMap((w) => w.data).every((d) => d.values.length <= 500)).toBe(true);
  });

  it('the title is one clean line; bad input never reaches the API', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await expect(client.upsertSpreadsheet(folder, { title: 'x', sheets: [] })).rejects.toMatchObject({ code: 'bad_response' });
    await expect(client.upsertSpreadsheet(folder, { title: 'x', sheets: 'nope' })).rejects.toMatchObject({ code: 'bad_response' });
    await expect(client.upsertSpreadsheet("a'b", { title: 'x', sheets: SH() })).rejects.toMatchObject({ code: 'bad_response' });
    expect(drive.spreadsheets()).toHaveLength(0);
    await client.upsertSpreadsheet(folder, { title: '  Casa \n  Soto  ', sheets: SH() });
    expect(drive.spreadsheets()[0].name).toBe('Casa Soto');
    await client.upsertSpreadsheet(folder, { title: '', sheets: SH() });
    expect(drive.spreadsheets().map((f) => f.name).sort()).toEqual(['Casa Soto', 'Rendicion']);
  });
});

describe('3. Refresh in place: the same Sheet, never a copy', () => {
  it('a second export finds it by name and rewrites the tabs (no create, no move)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    const first = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH('uno') });
    drive.calls.length = 0;
    const second = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH('dos') });
    expect(second).toEqual({ id: first.id, created: false });
    expect(drive.spreadsheets()).toHaveLength(1);
    expect(urls(drive).some((u) => u === 'POST /v4/spreadsheets')).toBe(false);
    expect(urls(drive).some((u) => u.startsWith('PATCH'))).toBe(false);
    expect(drive.sheet('rendicion-Casa').tabs.Resumen).toEqual([['Total', 100], ['dos']]);
  });

  it('fewer rows than before: the old tail is cleared; a tab the user added and a renamed tab are left alone; a missing tab comes back', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 's', sheets: [{ name: 'Gastos', rows: [['a'], ['b'], ['c']] }, { name: 'Pagos', rows: [['p']] }] });
    const { grids } = drive.sheet('s');
    grids.push({ sheetId: 99, title: 'Mis cálculos', rowCount: 100, columnCount: 10, rows: [['mine']] }); // typed by the user
    grids.find((g) => g.title === 'Pagos').title = 'Pagos (mío)'; // renamed by the user
    await client.upsertSpreadsheet(folder, { title: 's', sheets: [{ name: 'Gastos', rows: [['a']] }, { name: 'Pagos', rows: [['p2']] }] });
    const sheet = drive.sheet('s');
    expect(sheet.tabs.Gastos).toEqual([['a']]); // 'b' and 'c' are gone
    expect(sheet.tabs['Mis cálculos']).toEqual([['mine']]); // untouched
    expect(sheet.tabs['Pagos (mío)']).toEqual([['p']]); // not ours any more: untouched
    expect(sheet.tabs.Pagos).toEqual([['p2']]); // ours again, added
  });

  it('a tab that grew past its grid is expanded before the write (no "exceeds grid limits")', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 's', sheets: [{ name: 'Gastos', rows: [['a']] }] });
    const rows = Array.from({ length: 400 }, (_, i) => [i]);
    await client.upsertSpreadsheet(folder, { title: 's', sheets: [{ name: 'Gastos', rows }] });
    expect(drive.sheet('s').tabs.Gastos).toHaveLength(400);
  });
});

describe('4. Failure windows: idempotent, no duplicates', () => {
  it('created in the root but the move never happened (the app died): the next try ADOPTS it instead of creating a second one', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    // the Drive PATCH (the move) fails once, after the Spreadsheet exists
    const real = drive.fetchImpl;
    let blocked = true;
    const flaky = createDriveClient({
      getToken: async () => drive.token,
      fetchImpl: async (url, init) => {
        if (blocked && (init?.method || 'GET') === 'PATCH') throw new TypeError('Failed to fetch');
        return real(url, init);
      },
    });
    flaky.forgetFolders();
    await expect(flaky.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH() })).rejects.toMatchObject({ code: 'offline' });
    expect(drive.spreadsheets()).toHaveLength(1);
    expect(drive.spreadsheets()[0].parents).toEqual(['root']);
    blocked = false;
    const out = await flaky.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH('ok') });
    expect(drive.spreadsheets()).toHaveLength(1); // adopted
    expect(drive.spreadsheets()[0].parents).toEqual([folder]);
    expect(out.created).toBe(false);
    expect(drive.sheet('rendicion-Casa').tabs.Resumen).toEqual([['Total', 100], ['ok']]);
  });

  it('moved but the data write failed: the retry finds it in its folder and fills it (still ONE Sheet)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    const real = drive.fetchImpl;
    let fail = true;
    const flaky = createDriveClient({
      getToken: async () => drive.token,
      fetchImpl: async (url, init) => {
        if (fail && String(url).includes('values:batchUpdate')) throw new TypeError('Failed to fetch');
        return real(url, init);
      },
    });
    await expect(flaky.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH() })).rejects.toMatchObject({ code: 'offline' });
    expect(drive.sheet('rendicion-Casa').parents).toEqual([folder]);
    expect(drive.sheet('rendicion-Casa').tabs.Resumen).toEqual([]);
    fail = false;
    await flaky.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: SH() });
    expect(drive.spreadsheets()).toHaveLength(1);
    expect(drive.sheet('rendicion-Casa').tabs.Resumen).toEqual([['Total', 100], ['x']]);
  });

  it('a Sheet in the trash, or with the same name in another folder, is not the one of this folder', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const a = await client.ensureFolderPath(['Proyectos', 'A']);
    const b = await client.ensureFolderPath(['Proyectos', 'B']);
    await client.upsertSpreadsheet(a, { title: 'rendicion', sheets: SH() });
    await client.upsertSpreadsheet(b, { title: 'rendicion', sheets: SH() });
    expect(drive.spreadsheets().map((f) => f.parents[0]).sort()).toEqual([a, b].sort());
  });
});

describe('5. Errors map to the offline queue rules (auth / offline / quota / http)', () => {
  it('no connection = offline; 5xx = http; 429 = quota; the Sheets API switched off in the Cloud project = http (retrying cannot fix it, but it must not look like a quota)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    drive.state.offline = true;
    await expect(client.upsertSpreadsheet(folder, { title: 't', sheets: SH() })).rejects.toMatchObject({ code: 'offline' });
    drive.state.offline = false;
    drive.state.failNextSheets = 1;
    drive.state.status = 500;
    await expect(client.upsertSpreadsheet(folder, { title: 't', sheets: SH() })).rejects.toMatchObject({ code: 'http', status: 500 });
    drive.state.failNextSheets = 1;
    drive.state.status = 429;
    await expect(client.upsertSpreadsheet(folder, { title: 't', sheets: SH() })).rejects.toMatchObject({ code: 'quota', status: 429 });
    const off = createDriveClient({
      getToken: async () => 'tok',
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'Google Sheets API has not been used in project 123 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }) }),
    });
    await expect(off.upsertSpreadsheet('root', { title: 't', sheets: SH() })).rejects.toMatchObject({ code: 'http', status: 403 });
  });

  it('a token WITHOUT the spreadsheets scope (403 insufficient scopes) is an AUTH problem: the token is forgotten so the user is asked again', async () => {
    const drive = createFakeDrive();
    const rejected = vi.fn();
    const client = make(drive, { onAuthRejected: rejected });
    const folder = await folderOf(client);
    drive.state.noSheetsScope = true;
    await expect(client.upsertSpreadsheet(folder, { title: 't', sheets: SH() })).rejects.toMatchObject({ code: 'auth', status: 403 });
    expect(rejected).toHaveBeenCalledWith(drive.token);
    expect(drive.spreadsheets()).toHaveLength(0);
  });

  it('a plain 403 with no readable body is still a rate limit (the old rule); a rate-limit 403 is quota', async () => {
    const mk = (body) => createDriveClient({ getToken: async () => 'tok', fetchImpl: async () => ({ ok: false, status: 403, json: async () => { if (body === null) throw new Error('no body'); return body; } }) });
    await expect(mk(null).ensureFolder()).rejects.toMatchObject({ code: 'quota', status: 403 });
    await expect(mk({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }).ensureFolder()).rejects.toMatchObject({ code: 'quota', status: 403 });
  });

  it('an expired token is renewed silently once and the request repeated (the Sheets calls share the Drive client rules)', async () => {
    const drive = createFakeDrive();
    let held = drive.token;
    const refresh = vi.fn(async () => {
      drive.rotate('tok-final-12345');
      held = 'tok-final-12345';
      return held;
    });
    const client = createDriveClient({ getToken: async () => held, refreshToken: refresh, fetchImpl: drive.fetchImpl });
    const folder = await folderOf(client);
    drive.rotate('tok-rotated-0000'); // the one the client holds has expired
    await expect(client.upsertSpreadsheet(folder, { title: 't', sheets: SH() })).resolves.toMatchObject({ created: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('6. CSP: every URL of the flow is allowed (policy.js and vercel.json, in sync)', () => {
  // CSP path matching: a source path ending in "/" is a prefix; otherwise the path must match exactly
  const allows = (sources, url) => {
    const u = new URL(url);
    return sources.some((s) => {
      const a = new URL(s);
      if (a.origin !== u.origin) return false;
      return a.pathname.endsWith('/') ? u.pathname.startsWith(a.pathname) : u.pathname === a.pathname;
    });
  };

  it('create, read tabs, addSheet, clear, write, move: all allowed', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 'a', sheets: SH() });
    await client.upsertSpreadsheet(folder, { title: 'a', sheets: [...SH(), { name: 'Nueva', rows: [['x']] }] });
    const sources = CSP_DIRECTIVES['connect-src'].filter((x) => x.startsWith('https://'));
    expect(drive.calls.some((c) => c.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/'))).toBe(true);
    for (const call of drive.calls) expect(allows(sources, call.url), call.url).toBe(true);
  });

  it('vercel.json carries the very same sources, and nothing wider than the two Sheets paths', () => {
    const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
    const connect = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith('connect-src')).split(/\s+/).slice(1);
    expect(connect).toEqual(CSP_DIRECTIVES['connect-src']);
    expect(connect.filter((x) => x.includes('sheets.googleapis.com'))).toEqual(['https://sheets.googleapis.com/v4/spreadsheets', 'https://sheets.googleapis.com/v4/spreadsheets/']);
  });
});

describe('7. The dossier: the Sheet is refreshed in place and goes LAST', () => {
  it('PDFs and photos first, the Sheet after; a second sync does not duplicate it', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const documents = async () => [{ name: 'rendicion-Casa', sheets: SH() }, { name: 'Bitacora_Casa.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }];
    const first = await syncDossier({ client, title: 'Casa', documents });
    expect(first).toMatchObject({ documents: 2, failed: 0 });
    const order = drive.calls.filter((c) => c.method === 'POST' && (c.url.includes('/upload/drive/') || c.url.includes('sheets.googleapis.com/v4/spreadsheets?'))).map((c) => (c.url.includes('sheets') ? 'sheet' : 'pdf'));
    expect(order).toEqual(['pdf', 'sheet']);
    await syncDossier({ client, title: 'Casa', documents });
    expect(drive.spreadsheets()).toHaveLength(1);
    expect(drive.backupFiles().filter((f) => f.name === 'Bitacora_Casa.pdf')).toHaveLength(1);
  });

  it('a device that has not granted the Sheets scope yet still gets its PDFs, and the sync reports "auth" (the reconnect prompt)', async () => {
    const drive = createFakeDrive();
    drive.state.noSheetsScope = true;
    const client = make(drive);
    const documents = async () => [{ name: 'rendicion-Casa', sheets: SH() }, { name: 'Bitacora_Casa.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }];
    await expect(syncDossier({ client, title: 'Casa', documents })).rejects.toMatchObject({ code: 'auth' });
    expect(drive.backupFiles().some((f) => f.name === 'Bitacora_Casa.pdf')).toBe(true);
  });
});

describe('8. The export sheet: "Rendición en Google Sheets" goes to Drive / the queue, never to the phone', () => {
  const ctx = (sendSheet) => ({ project: { id: 'p', draft: {} }, result: { valid: false }, total: 0, company: {}, photos: [], i18n: {}, setDraft: () => {}, sendSheet });

  it('xlsx = the app delivers the Sheet: uploaded -> "sent", parked -> "queued", busy / failed -> "cancelled" (the sheet stays open)', async () => {
    expect(await runExport('xlsx', ctx(async () => ({ status: 'uploaded' })))).toBe('sent');
    expect(await runExport('xlsx', ctx(async () => ({ status: 'queued', reason: 'offline' })))).toBe('queued');
    expect(await runExport('xlsx', ctx(async () => null))).toBe('cancelled');
    expect(await runExport('xlsx', ctx(async () => ({ status: 'failed', reason: 'queue_full' })))).toBe('cancelled');
    await expect(runExport('xlsx', ctx(null))).rejects.toThrow();
  });
});

describe('9. The hand-made .xlsx is gone', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

  it('no module builds a binary workbook: no lib/xlsx.js, no fflate import, no multipart upload of spreadsheet bytes', () => {
    expect(fs.existsSync('src/lib/xlsx.js')).toBe(false);
    for (const f of walk('src').filter((x) => /\.(js|jsx)$/.test(x))) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/from ['"]fflate['"]/);
      expect(text, f).not.toMatch(/lib\/xlsx|\.\/xlsx\.js|buildXlsx|xlsxToFile|buildRenditionFile|buildRenditionBytes/);
    }
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies?.fflate).toBeUndefined();
  });

  it('DriveError is still the one error type of the flow', () => {
    expect(new DriveError('auth', 403)).toMatchObject({ code: 'auth', status: 403 });
  });
});
