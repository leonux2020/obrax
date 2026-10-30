// @vitest-environment happy-dom
// "Cerrar Rendición": the Excel (Hoja 1 financial summary + Hoja 2 expense detail) goes to Drive and is NEVER downloaded; with no connection or when
// Drive fails it is parked in IndexedDB (exportQueue) and uploaded by the background sync. Plus the "Adelantos / Caja chica" fund of the project.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { unzipSync, strFromU8 } from 'fflate';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import { DB_VERSION, STORE_EXPORTS, STORE_PROJECTS, createRunner } from '../src/lib/db.js';
import { createExportQueue, idbExportBackend, normalizeExportRow, EXPORT_QUEUE_LIMITS } from '../src/lib/exportQueue.js';
import { closeRendition, deliverRendition, drainExportQueue, renditionFileName, uploadRendition, backoffMs } from '../src/lib/exportSync.js';
import { buildRenditionSheets, buildRenditionBytes } from '../src/lib/rendition.js';
import { expensesByCategory, newFundEntry, normalizeExpenses, normalizePayments } from '../src/lib/ledger.js';
import { newProject } from '../src/lib/projects.js';
import { DriveError } from '../src/lib/drive.js';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { createDriveClient } from '../src/lib/drive.js';
import ProjectFinancialDashboard from '../src/components/ProjectFinancialDashboard.jsx';
import GlobalAccounting from '../src/components/GlobalAccounting.jsx';

globalThis.Blob = NodeBlob; // fake-indexeddb's structured clone needs Node's Blob
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const i18n = makeI18n('es', 'CL');
const project = (extra = {}) => {
  const p = newProject({ regionCode: 'CL', name: 'Casa Soto', client: 'Ana', now: 1000 });
  p.payments = normalizePayments([{ id: 'adel0001', amount: 100000, at: Date.UTC(2026, 9, 1), note: 'Adelanto materiales' }, { id: 'adel0002', amount: 50000, at: Date.UTC(2026, 9, 5), note: 'Caja chica' }]);
  p.expenses = normalizeExpenses([
    { id: 'gasto001', amount: 30000, category: 'material', supplier: 'Sodimac', description: 'Cemento', date: '2026-10-02' },
    { id: 'gasto002', amount: 20000, category: 'material', supplier: 'sodimac ', description: 'Clavos' },
    { id: 'gasto003', amount: 15000, category: 'transport', supplier: 'Copec', description: 'Diésel' },
    { id: 'gasto004', amount: 5000, category: 'food', supplier: '', description: 'Almuerzo' },
  ]);
  return Object.assign(p, extra);
};
const totals = (p) => new Map([[p.id, 1_000_000]]);
const xlsx = (bytes) => unzipSync(bytes);

describe('Adelantos / Caja chica (the fund of a project)', () => {
  it('newFundEntry: a stored payment with the picked day (at local noon), the amount and a clean description', () => {
    const e = newFundEntry({ amount: 25000, date: '2026-10-29', note: '  <b>Adelanto</b> cemento ' });
    expect(e).toMatchObject({ amount: 25000, note: expect.stringContaining('Adelanto') });
    expect(e.note).not.toContain('<');
    expect(e.at).toBe(new Date('2026-10-29T12:00:00').getTime());
    expect(e.id).toMatch(/^[a-z0-9]{4,24}$/);
  });
  it('rejects a missing / negative / zero amount; an odd date falls back to now', () => {
    expect(newFundEntry({ amount: null })).toBeNull();
    expect(newFundEntry({ amount: 0 })).toBeNull();
    expect(newFundEntry({ amount: -5 })).toBeNull();
    expect(newFundEntry({ amount: 10, date: 'mañana' }, 5555).at).toBe(5555);
    expect(newFundEntry({ amount: 10, date: '' }, 7777).at).toBe(7777);
  });
  it('survives the project validation (it is saved with the project in IndexedDB like every payment)', () => {
    const e = newFundEntry({ amount: 99, date: '2026-10-29', note: 'x' });
    expect(normalizePayments([e])).toEqual([e]);
  });
  it('expensesByCategory: biggest first, unknown categories are "other"', () => {
    expect(expensesByCategory(project().expenses).map((g) => [g.category, g.total, g.count])).toEqual([['material', 50000, 2], ['transport', 15000, 1], ['food', 5000, 1]]);
    expect(expensesByCategory([{ amount: 1, category: 'zzz' }])[0].category).toBe('other');
  });
});

describe('Excel: Hoja 1 financial summary, Hoja 2 expense detail (the fiscal table is untouched)', () => {
  const sheets = buildRenditionSheets([project()], totals(project()), { t: i18n.t, locale: 'es', currency: 'CLP' });
  const cells = (rows) => rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)));

  it('Hoja 1 is the financial summary and Hoja 2 the expense detail, with the same 16 fiscal columns as before', () => {
    expect(sheets).toHaveLength(5);
    expect(sheets[0].name).toBe('Resumen financiero');
    expect(sheets[1].name).toBe('Detalle de gastos');
    expect(sheets[1].rows[0]).toHaveLength(16);
    // the generator of the columns is untouched: same keys, same order
    expect(cells(sheets[1].rows)[0]).toEqual(['xl.date', 'xl.docType', 'xl.docNumber', 'xl.supplier', 'xl.taxId', 'xl.description', 'xl.category', 'xl.quantity', 'xl.unitPrice', 'xl.net', 'xl.tax', 'xl.grossTotal', 'xl.currency', 'xl.payment', 'xl.returnDate', 'xl.returned'].map((k) => i18n.t(k)));
    expect(sheets[1].rows).toHaveLength(5); // header + 4 lines
  });

  it('Hoja 1: advances vs expenses, balance to account for, by category and by supplier', () => {
    const rows = cells(sheets[0].rows);
    const row = (label) => rows.find((r) => r[0] === label);
    expect(row('Fondo asignado (adelantos / caja chica)')[1]).toBe(150000);
    expect(row('Total gastado')[1]).toBe(70000);
    expect(row('Saldo a rendir')[1]).toBe(80000);
    // by category: money + share of the spending
    expect(row('Material')).toEqual(['Material', 50000, expect.stringMatching(/71/)]);
    expect(row('Combustible / Transporte')[1]).toBe(15000);
    // by supplier: "Sodimac" and "sodimac " are ONE shop; the nameless ones are grouped
    expect(row('Sodimac')).toEqual(['Sodimac', 50000, 2]);
    expect(row('Copec')[1]).toBe(15000);
    expect(row('Sin proveedor')).toEqual(['Sin proveedor', 5000, 1]);
    // the old summary rows are still there
    expect(rows.some((r) => r[0] === 'Casa Soto' || r[1] === 'Casa Soto')).toBe(true);
    expect(row('Saldo en caja')).toBeTruthy();
  });

  it('the consolidated (several projects) summary keeps its shape', () => {
    const a = project();
    const b = project();
    const s = buildRenditionSheets([a, b], new Map([[a.id, 1], [b.id, 2]]), { t: i18n.t, locale: 'es', currency: '' });
    expect(s[1].rows[0]).toHaveLength(17);
    expect(s[0].rows.at(-1)[0].v).toBe('Total');
  });

  it('buildRenditionBytes is a real .xlsx with the five sheets in order', () => {
    const files = xlsx(buildRenditionBytes([project()], totals(project()), { t: i18n.t, locale: 'es', currency: 'CLP', digits: 0 }));
    const wb = strFromU8(files['xl/workbook.xml']);
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]).slice(0, 2)).toEqual(['Resumen financiero', 'Detalle de gastos']);
    expect(Object.keys(files).filter((f) => f.startsWith('xl/worksheets/'))).toHaveLength(5);
  });
});

describe('exportQueue (IndexedDB store export_queue, DB v6)', () => {
  const xl = () => new Blob([Uint8Array.from([80, 75, 3, 4, 1, 2, 3])], { type: 'application/octet-stream' });
  const P = 'proyecto01';
  let queue;
  beforeEach(() => {
    queue = createExportQueue();
  });

  it('keeps the Excel blob and its Drive destination; a hostile row is dropped', async () => {
    const row = await queue.enqueue({ projectId: P, title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx', blob: xl(), now: 5 });
    expect(row).toMatchObject({ status: 'pending', attempts: 0, title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx' });
    expect((await queue.bytesOf(row)).length).toBe(7);
    expect(normalizeExportRow({ ...row, fileName: '../../etc/passwd' })).toBeNull();
    expect(normalizeExportRow({ ...row, fileName: 'x.exe' })).toBeNull();
    expect(normalizeExportRow({ ...row, blob: 'not a blob' })).toBeNull();
    expect(normalizeExportRow({ ...row, projectId: 'x' })).toBeNull();
    await expect(queue.enqueue({ projectId: P, fileName: 'nope.txt', blob: xl() })).rejects.toThrow('bad_file');
  });

  it('closing the same project the same day REPLACES the waiting file; another project / day is a new row', async () => {
    await queue.enqueue({ projectId: P, title: 'A', fileName: 'Rendicion_2026-10-30.xlsx', blob: xl() });
    await queue.enqueue({ projectId: P, title: 'A', fileName: 'Rendicion_2026-10-30.xlsx', blob: xl() });
    await queue.enqueue({ projectId: P, title: 'A', fileName: 'Rendicion_2026-10-31.xlsx', blob: xl() });
    await queue.enqueue({ projectId: 'proyecto02', title: 'B', fileName: 'Rendicion_2026-10-30.xlsx', blob: xl() });
    expect(await queue.list()).toHaveLength(3);
    await queue.removeProject(P);
    expect((await queue.list()).map((r) => r.projectId)).toEqual(['proyecto02']);
  });

  it('is bounded (queue_full) and a page that died mid-send puts the row back to pending', async () => {
    for (let i = 0; i < EXPORT_QUEUE_LIMITS.maxItems; i += 1) await queue.enqueue({ projectId: P, fileName: `Rendicion_2026-01-${String(i + 1).padStart(2, '0')}.xlsx`, blob: xl() });
    await expect(queue.enqueue({ projectId: P, fileName: 'Rendicion_2027-01-01.xlsx', blob: xl() })).rejects.toThrow('queue_full');
    const [first] = await queue.list();
    await queue.update(first.id, { status: 'sending' });
    await queue.recover();
    expect((await queue.list())[0].status).toBe('pending');
  });

  it('persists in IndexedDB: the blob survives a reload of the queue', async () => {
    const factory = new IDBFactory();
    const a = createExportQueue(idbExportBackend(factory));
    await a.enqueue({ projectId: P, title: 'Casa', fileName: 'Rendicion_2026-10-30.xlsx', blob: xl(), now: 9 });
    const b = createExportQueue(idbExportBackend(factory)); // "the app was closed and reopened"
    const [row] = await b.list();
    expect(row.fileName).toBe('Rendicion_2026-10-30.xlsx');
    expect((await b.bytesOf(row))[0]).toBe(80);
  });

  it('DB v5 -> v6 adds export_queue and loses nothing', async () => {
    expect(DB_VERSION).toBe(6);
    expect(STORE_EXPORTS).toBe('export_queue');
    const factory = new IDBFactory();
    await new Promise((resolve, reject) => {
      const req = factory.open('obrax', 5);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      req.onsuccess = () => {
        const tx = req.result.transaction(STORE_PROJECTS, 'readwrite');
        tx.objectStore(STORE_PROJECTS).put({ id: 'proyecto01', name: 'viejo' });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    const run = createRunner(factory);
    expect(await run(STORE_EXPORTS, 'readonly', (s) => s.count())).toBe(0);
    expect(await run(STORE_PROJECTS, 'readonly', (s) => s.get('proyecto01'))).toEqual({ id: 'proyecto01', name: 'viejo' });
  });
});

describe('deliverRendition / closeRendition: Drive or the queue, never a download', () => {
  const file = { fileName: 'Rendicion_2026-10-30.xlsx', bytes: Uint8Array.from([80, 75, 3, 4]) };
  const proj = { id: 'proyecto01', title: 'Casa Soto' };
  let queue;
  let download;
  beforeEach(() => {
    queue = createExportQueue();
    // anything that would put the file in the phone's Downloads
    URL.createObjectURL ??= () => 'blob:x';
    download = vi.spyOn(URL, 'createObjectURL');
  });
  afterEach(() => vi.restoreAllMocks());

  it('online with a token: it goes up to Drive and nothing is parked or downloaded', async () => {
    const upload = vi.fn(async () => {});
    const out = await deliverRendition({ file, project: proj, upload, ensureToken: async () => 'tok', queue, online: () => true });
    expect(out).toEqual({ status: 'uploaded' });
    expect(upload).toHaveBeenCalledWith({ title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx', bytes: file.bytes });
    expect(await queue.list()).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it('offline: NOT downloaded, NOT sent: the Blob waits in the queue ("Sin conexión")', async () => {
    const upload = vi.fn();
    const out = await deliverRendition({ file, project: proj, upload, ensureToken: async () => 'tok', queue, online: () => false });
    expect(out).toEqual({ status: 'queued', reason: 'offline' });
    expect(upload).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    const [row] = await queue.list();
    expect(row).toMatchObject({ projectId: 'proyecto01', title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx', status: 'pending' });
    expect((await queue.bytesOf(row)).length).toBe(4);
  });

  it('Drive fails (offline error, 500, quota) or there is no Google session: parked, never downloaded', async () => {
    for (const [err, reason] of [[new DriveError('offline'), 'offline'], [new DriveError('http', 500), 'error'], [new DriveError('quota', 429), 'quota'], [new Error('boom'), 'error']]) {
      const q = createExportQueue();
      const out = await deliverRendition({ file, project: proj, upload: async () => { throw err; }, ensureToken: async () => 'tok', queue: q, online: () => true });
      expect(out).toEqual({ status: 'queued', reason });
      expect(await q.list()).toHaveLength(1);
    }
    const q = createExportQueue();
    expect(await deliverRendition({ file, project: proj, upload: vi.fn(), ensureToken: async () => null, queue: q, online: () => true })).toEqual({ status: 'queued', reason: 'auth' });
    expect(download).not.toHaveBeenCalled();
  });

  it('Drive not configured: says so and parks nothing; a full queue is reported', async () => {
    expect(await deliverRendition({ file, project: proj, upload: vi.fn(), ensureToken: async () => 'tok', queue, online: () => true, configured: false })).toEqual({ status: 'not_configured' });
    expect(await queue.list()).toHaveLength(0);
    const full = { enqueue: async () => { throw new Error('queue_full'); } };
    expect(await deliverRendition({ file, project: proj, upload: vi.fn(), ensureToken: async () => 'tok', queue: full, online: () => false })).toEqual({ status: 'failed', reason: 'queue_full' });
  });

  it('closeRendition builds the real Excel and names it Rendicion_<date>.xlsx', async () => {
    const p = project();
    const upload = vi.fn(async () => {});
    const now = new Date(2026, 9, 30, 12).getTime();
    const out = await closeRendition({ project: p, totals: totals(p), i18n, now, upload, ensureToken: async () => 'tok', queue, online: () => true });
    expect(out.status).toBe('uploaded');
    const arg = upload.mock.calls[0][0];
    expect(arg.fileName).toBe('Rendicion_2026-10-30.xlsx');
    expect(renditionFileName(now)).toBe('Rendicion_2026-10-30.xlsx');
    expect(arg.title).toBe('Casa Soto');
    expect(Object.keys(xlsx(arg.bytes))).toContain('xl/worksheets/sheet2.xml');
  });
});

describe('Drive destination: CUBRAX - Respaldos Obra / Proyectos / <project> / Rendicion_<date>.xlsx', () => {
  let drive;
  let client;
  beforeEach(() => {
    drive = createFakeDrive();
    client = createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
  });
  const byName = (n) => drive.backupFiles().filter((f) => f.name === n);

  it('creates the folder path with the existing Drive client and replaces the same-day file instead of piling copies', async () => {
    const bytes = Uint8Array.from([80, 75, 3, 4, 9]);
    await uploadRendition({ client, title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx', bytes });
    await uploadRendition({ client, title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx', bytes: Uint8Array.from([80, 75, 3, 4, 9, 9]) });
    await uploadRendition({ client, title: 'Casa Soto', fileName: 'Rendicion_2026-10-31.xlsx', bytes });
    const [root, proyectos, casa] = ['CUBRAX - Respaldos Obra', 'Proyectos', 'Casa Soto'].map((n) => drive.folders().find((f) => f.name === n));
    expect(proyectos.parents).toEqual([root.id]);
    expect(casa.parents).toEqual([proyectos.id]);
    expect(byName('Rendicion_2026-10-30.xlsx')).toHaveLength(1);
    expect(byName('Rendicion_2026-10-30.xlsx')[0].body.length).toBe(6); // the second one won
    expect(byName('Rendicion_2026-10-31.xlsx')).toHaveLength(1);
    expect(byName('Rendicion_2026-10-30.xlsx')[0].parents).toEqual([casa.id]);
  });

  it('a folder deleted from Drive behind our back (404) is looked up again once', async () => {
    await uploadRendition({ client, title: 'Casa Soto', fileName: 'Rendicion_2026-10-30.xlsx', bytes: Uint8Array.from([1, 2, 3, 4, 5]) });
    for (const f of drive.folders().filter((x) => x.name === 'Casa Soto')) drive.files.delete(f.id);
    await uploadRendition({ client, title: 'Casa Soto', fileName: 'Rendicion_2026-10-31.xlsx', bytes: Uint8Array.from([1, 2, 3, 4, 5]) });
    expect(byName('Rendicion_2026-10-31.xlsx')).toHaveLength(1);
  });
});

describe('drainExportQueue: the background sync (receiptSync twin)', () => {
  const blob = () => new Blob([Uint8Array.from([80, 75, 3, 4])]);
  let queue;
  const park = (name = 'Rendicion_2026-10-30.xlsx', projectId = 'proyecto01') => queue.enqueue({ projectId, title: 'Casa', fileName: name, blob: blob(), now: 1 });
  beforeEach(() => {
    queue = createExportQueue();
  });

  it('does nothing (and sends nothing) while offline', async () => {
    await park();
    const upload = vi.fn();
    const res = await drainExportQueue({ queue, upload, online: () => false });
    expect(res.skipped).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(await queue.list()).toHaveLength(1);
  });

  it('when the network is back it uploads every parked file to its folder and empties the queue', async () => {
    await park('Rendicion_2026-10-30.xlsx');
    await park('Rendicion_2026-10-31.xlsx', 'proyecto02');
    const upload = vi.fn(async () => {});
    const res = await drainExportQueue({ queue, upload, online: () => true, ensureToken: async () => 'tok' });
    expect(res.done).toHaveLength(2);
    expect(upload.mock.calls.map((c) => c[0].fileName).sort()).toEqual(['Rendicion_2026-10-30.xlsx', 'Rendicion_2026-10-31.xlsx']);
    expect(upload.mock.calls[0][0]).toMatchObject({ title: 'Casa' });
    expect(upload.mock.calls[0][0].bytes).toBeInstanceOf(Uint8Array);
    expect(await queue.list()).toHaveLength(0);
  });

  it('a connectivity failure keeps the file, backs off and stops the run; the attempts are not used up', async () => {
    await park('Rendicion_2026-10-30.xlsx');
    await park('Rendicion_2026-10-31.xlsx');
    const upload = vi.fn(async () => { throw new DriveError('offline'); });
    const res = await drainExportQueue({ queue, upload, online: () => true, now: () => 1_000_000 });
    expect(upload).toHaveBeenCalledTimes(1); // the second one did not even try
    expect(res.deferred).toBe(2);
    const rows = await queue.list();
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(rows.every((r) => r.attempts === 0 && r.nextAt === 1_000_000 + backoffMs(1))).toBe(true);
    // not due yet -> nothing happens; due later -> it goes up
    expect((await drainExportQueue({ queue, upload, online: () => true, now: () => 1_000_001 })).done).toHaveLength(0);
    expect(upload).toHaveBeenCalledTimes(1);
    const ok = vi.fn(async () => {});
    expect((await drainExportQueue({ queue, upload: ok, online: () => true, now: () => 1_000_000 + backoffMs(1) + 1 })).done).toHaveLength(2);
  });

  it('no Google session in the background: the file waits (no screen is opened)', async () => {
    await park();
    const upload = vi.fn();
    const res = await drainExportQueue({ queue, upload, online: () => true, ensureToken: async () => null, now: () => 5 });
    expect(upload).not.toHaveBeenCalled();
    expect(res.done).toHaveLength(0);
    expect((await queue.list())[0]).toMatchObject({ status: 'pending', lastError: 'auth' });
  });

  it('Drive errors count attempts; after too many the row is kept as failed, and a forced retry sends it', async () => {
    await park();
    let now = 0;
    const bad = vi.fn(async () => { throw new DriveError('http', 500); });
    for (let i = 0; i < EXPORT_QUEUE_LIMITS.maxAttempts; i += 1) {
      now += 24 * 3600_000;
      await drainExportQueue({ queue, upload: bad, online: () => true, now: () => now });
    }
    const [row] = await queue.list();
    expect(row).toMatchObject({ status: 'failed', attempts: EXPORT_QUEUE_LIMITS.maxAttempts, lastError: 'http' });
    const good = vi.fn(async () => {});
    const res = await drainExportQueue({ queue, upload: good, online: () => true, force: true });
    expect(res.done).toHaveLength(1);
    expect(await queue.list()).toHaveLength(0);
  });

  it('never runs twice at once', async () => {
    await park();
    let release;
    const gate = new Promise((r) => (release = r));
    const upload = vi.fn(async () => gate);
    const first = drainExportQueue({ queue, upload, online: () => true });
    const second = drainExportQueue({ queue, upload, online: () => true });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([first, second]);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectFinancialDashboard + the Contabilidad card', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  const click = async (el) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
  };
  const type = (el, value) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const mount = (node) => act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node)));

  it('three OLED headers (Fondo asignado, Total gastado, Saldo a rendir), the supplier carousel and the grand total', async () => {
    await mount(React.createElement(ProjectFinancialDashboard, { project: project(), onChange: () => {}, onBack: () => {}, onCloseRendition: async () => {}, queue: createExportQueue() }));
    expect(q('fin-fund').textContent).toContain('Fondo asignado');
    expect(q('fin-fund-value').textContent).toContain('150.000');
    expect(q('fin-spent-value').textContent).toContain('70.000');
    expect(q('fin-balance').textContent).toContain('Saldo a rendir');
    expect(q('fin-balance-value').textContent).toContain('80.000');
    expect(q('fin-balance-value').className).toContain('text-brand');
    expect([...q('fin-expenses').querySelectorAll('[data-testid="supplier-total-name"]')].map((n) => n.textContent)).toEqual(['Sodimac', 'Copec', 'Sin proveedor']);
    expect(q('fin-expenses-total').textContent).toContain('70.000');
    expect(q('fin-close').textContent).toContain('Cerrar Rendición (Enviar a Drive)');
  });

  it('an overspent project shows the balance in red', async () => {
    const p = project({ payments: [] });
    await mount(React.createElement(ProjectFinancialDashboard, { project: p, onChange: () => {}, onBack: () => {}, onCloseRendition: async () => {}, queue: createExportQueue() }));
    expect(q('fin-balance-value').className).toContain('text-red-400');
    expect(q('fin-income-empty')).not.toBeNull();
  });

  it('the quick manager adds an advance (date, amount, description) and deletes one; an empty amount cannot be added', async () => {
    const changes = [];
    const p = project();
    await mount(React.createElement(ProjectFinancialDashboard, { project: p, onChange: (c) => changes.push(c), onBack: () => {}, onCloseRendition: async () => {}, queue: createExportQueue() }));
    expect(q('fin-income-add').disabled).toBe(true);
    const form = q('fin-income-form');
    await type(q('fin-income-date'), '2026-10-29');
    await type(form.querySelector('input[inputmode]'), '25000');
    await type(q('fin-income-note'), 'Adelanto herramientas');
    expect(q('fin-income-add').disabled).toBe(false);
    await click(q('fin-income-add'));
    expect(changes).toHaveLength(1);
    const [entry, ...rest] = changes[0].payments;
    expect(entry).toMatchObject({ amount: 25000, note: 'Adelanto herramientas', at: new Date('2026-10-29T12:00:00').getTime() });
    expect(rest.map((x) => x.id)).toEqual(['adel0001', 'adel0002']);
    expect(q('fin-income-add').disabled).toBe(true); // the form was cleared
    await click(q('fin-income-adel0001').querySelector('button'));
    expect(changes[1].payments.map((x) => x.id)).toEqual(['adel0002']);
  });

  it('"Cerrar Rendición" calls the delivery once (no double tap) and shows the waiting files of the offline queue', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const close = vi.fn(async () => gate);
    const queue = createExportQueue();
    const p = project();
    await queue.enqueue({ projectId: p.id, title: 'Casa', fileName: 'Rendicion_2026-10-30.xlsx', blob: new Blob([Uint8Array.from([1, 2, 3])]) });
    await mount(React.createElement(ProjectFinancialDashboard, { project: p, onChange: () => {}, onBack: () => {}, onCloseRendition: close, onRetryQueue: () => {}, queue }));
    expect(q('fin-queued').textContent).toContain('En cola: 1');
    await click(q('fin-close'));
    await click(q('fin-close'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(q('fin-close').textContent).toContain('Enviando a Drive');
    release();
    await flush(10);
    expect(q('fin-close').textContent).toContain('Cerrar Rendición');
  });

  it('Contabilidad: the checkbox ONLY selects; the body of the card opens the project\'s financial center', async () => {
    const a = project();
    const b = project();
    const open = vi.fn();
    await mount(React.createElement(GlobalAccounting, { projects: [a, b], onOpenProject: open }));
    await click(q(`acc-check-${a.id}`));
    expect(open).not.toHaveBeenCalled();
    expect(q(`acc-check-${a.id}`).checked).toBe(true);
    expect(q('acc-export').textContent).toContain('1');
    await click(q(`acc-open-${b.id}`));
    expect(open).toHaveBeenCalledWith(b.id);
    expect(q(`acc-check-${b.id}`).checked).toBe(false); // touching the body never selects
    expect(q('acc-export').textContent).toContain('1');
    await click(q(`acc-open-${a.id}`));
    expect(q(`acc-check-${a.id}`).checked).toBe(true); // ...nor unselects
  });
});
