// @vitest-environment happy-dom
// Three structural repairs: (1) anti-flicker OLED (solid #000000 base layers), (2) offline never freezes the UI (the connection is read
// synchronously, every network step is time-limited, the loading state is released in a finally), (3) the consolidated Excel goes to
// CUBRAX - Respaldos Obra / Rendiciones_Globales / Rendicion_Global_<date>.xlsx through the same offline queue and is never downloaded.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { unzipSync } from 'fflate';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import { createExportQueue } from '../src/lib/exportQueue.js';
import { closeGlobalRendition, closeRendition, deliverRendition, drainExportQueue, globalRenditionFileName, settleWithin, uploadRendition, withTimeout } from '../src/lib/exportSync.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeExpenses } from '../src/lib/ledger.js';
import { createDriveClient } from '../src/lib/drive.js';
import { createFakeDrive } from './helpers/fakeDrive.js';
import ProjectFinancialDashboard from '../src/components/ProjectFinancialDashboard.jsx';
import GlobalAccounting from '../src/components/GlobalAccounting.jsx';

globalThis.Blob = NodeBlob;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const i18n = makeI18n('es', 'CL');
const mkProject = (name, regionCode = 'CL') => {
  const p = newProject({ regionCode, name, client: 'Ana', now: 1000 });
  p.expenses = normalizeExpenses([{ id: 'gasto001', amount: 30000, category: 'material', supplier: 'Sodimac', description: 'Cemento', date: '2026-10-02' }]);
  return p;
};
const totalsOf = (...ps) => new Map(ps.map((p) => [p.id, 1_000_000]));
const NOW = new Date(2026, 9, 30, 12).getTime();

describe('1. Anti-flicker OLED: html, body and #root are solid #000000', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  it('src/index.css paints the three base layers #000000 (the print sheet is the only white)', () => {
    const base = css.match(/html,\s*body,\s*#root\s*\{[^}]*\}/)[0];
    expect(base).toMatch(/background-color:\s*#000000/);
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(css.slice(0, css.indexOf('@media print'))).not.toMatch(/(html|body|#root)[^{]*\{[^}]*background(-color)?:\s*(#fff|white)/);
    expect(printBlock).toMatch(/background:\s*#fff !important/);
  });
  it('index.html declares a dark canvas before any CSS (theme-color, color-scheme) and never an inline white', () => {
    expect(html).toMatch(/name="theme-color"\s+content="#000000"/);
    expect(html).toMatch(/name="color-scheme"\s+content="dark"/);
    expect(html).not.toMatch(/background(-color)?:\s*(#fff|white)/i);
  });
  it('no component paints a loader / overlay white or light grey', () => {
    for (const f of ['components/BottomSheet.jsx', 'components/ProjectFinancialDashboard.jsx', 'components/GlobalAccounting.jsx', 'components/SplashScreen.jsx']) {
      let src = '';
      try { src = readFileSync(resolve(process.cwd(), 'src', f), 'utf8'); } catch { continue; }
      expect(src).not.toMatch(/bg-(white(?![/\w])|gray-\d+|neutral-[1-5]\d\d|slate-[1-5]\d\d)\b/);
    }
  });
});

describe('2. Offline never leaves the UI hanging', () => {
  const file = { fileName: 'Rendicion_2026-10-30.xlsx', bytes: Uint8Array.from([80, 75, 3, 4]) };
  const proj = { id: 'proyecto01', title: 'Casa' };
  afterEach(() => vi.useRealTimers());

  it('offline: parked at once; the token and the network are never touched (even if they would hang forever)', async () => {
    const queue = createExportQueue();
    const never = () => new Promise(() => {});
    const upload = vi.fn(never);
    const ensureToken = vi.fn(never);
    const out = await deliverRendition({ file, project: proj, upload, ensureToken, queue, online: () => false });
    expect(out).toEqual({ status: 'queued', reason: 'offline' });
    expect(ensureToken).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(await queue.list()).toHaveLength(1);
  });

  it('"online" but the phone is really offline (the Google session never answers): the time limit parks the file', async () => {
    vi.useFakeTimers();
    const queue = createExportQueue();
    const p = deliverRendition({ file, project: proj, upload: vi.fn(), ensureToken: () => new Promise(() => {}), queue, online: () => true, timeouts: { token: 50, upload: 50 } });
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toEqual({ status: 'queued', reason: 'offline' });
    expect(await queue.list()).toHaveLength(1);
  });

  it('the upload that never answers is also cut and parked', async () => {
    vi.useFakeTimers();
    const queue = createExportQueue();
    const p = deliverRendition({ file, project: proj, upload: () => new Promise(() => {}), ensureToken: async () => 'tok', queue, online: () => true, timeouts: { token: 50, upload: 50 } });
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toEqual({ status: 'queued', reason: 'offline' });
  });

  it('withTimeout / settleWithin: late answers are ignored, early ones pass', async () => {
    vi.useFakeTimers();
    const slow = withTimeout(new Promise(() => {}), 10);
    const caught = slow.catch((e) => e.code);
    await vi.advanceTimersByTimeAsync(20);
    expect(await caught).toBe('offline');
    expect(await withTimeout(Promise.resolve(7), 10)).toBe(7);
    const w = settleWithin(new Promise(() => {}), 10, 'x');
    await vi.advanceTimersByTimeAsync(20);
    expect(await w).toBe('x');
  });

  describe('the screens release their loading state', () => {
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
    const dash = (props) => React.createElement(ProjectFinancialDashboard, { project: mkProject('Casa'), onChange: () => {}, onBack: () => {}, queue: createExportQueue(), ...props });

    it('dashboard: a rejected delivery frees the button', async () => {
      await mount(dash({ onCloseRendition: async () => { throw new Error('network'); } }));
      await click(q('fin-close'));
      expect(q('fin-close').disabled).toBe(false);
    });
    it('dashboard: a delivery that never answers is cut by the watchdog and frees the button', async () => {
      await mount(dash({ onCloseRendition: () => new Promise(() => {}), watchdogMs: 30 }));
      await click(q('fin-close'));
      expect(q('fin-close').disabled).toBe(true); // loading...
      await flush(60);
      expect(q('fin-close').disabled).toBe(false);
    });
    it('Contabilidad: rejected or hanging export frees the button', async () => {
      const a = mkProject('Uno');
      for (const onExportGlobal of [async () => { throw new Error('boom'); }, () => new Promise(() => {})]) {
        await mount(React.createElement(GlobalAccounting, { projects: [a], onExportGlobal, watchdogMs: 30 }));
        await click(q(`acc-check-${a.id}`));
        await click(q('acc-export'));
        await flush(60);
        expect(q('acc-export').disabled).toBe(false);
        await click(q(`acc-check-${a.id}`)); // untick for the next round
      }
    });
  });
});

describe('3. Excel consolidado global -> Rendiciones_Globales (same offline queue, never downloaded)', () => {
  let drive;
  let client;
  let queue;
  let download;
  beforeEach(() => {
    drive = createFakeDrive();
    client = createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
    queue = createExportQueue();
    URL.createObjectURL ??= () => 'blob:x';
    download = vi.spyOn(URL, 'createObjectURL');
  });
  afterEach(() => vi.restoreAllMocks());

  const a = mkProject('Uno');
  const b = mkProject('Dos');
  const deps = () => ({ upload: ({ kind, title, fileName, bytes }) => uploadRendition({ client, kind, title, fileName, bytes }), ensureToken: async () => 'tok', queue });

  it('the file is named Rendicion_Global_<date>.xlsx', () => {
    expect(globalRenditionFileName(NOW)).toBe('Rendicion_Global_2026-10-30.xlsx');
  });

  it('online: CUBRAX - Respaldos Obra / Rendiciones_Globales / Rendicion_Global_<date>.xlsx, a consolidated workbook, no download', async () => {
    let sent = null;
    const d = deps();
    const out = await closeGlobalRendition({ projects: [a, b], totals: totalsOf(a, b), i18n, now: NOW, online: () => true, ...d, upload: (arg) => { sent = arg; return d.upload(arg); } });
    expect(out).toEqual({ status: 'uploaded' });
    expect(sent).toMatchObject({ kind: 'global', fileName: 'Rendicion_Global_2026-10-30.xlsx' });
    const [root, folder] = ['CUBRAX - Respaldos Obra', 'Rendiciones_Globales'].map((n) => drive.folders().find((f) => f.name === n));
    expect(folder.parents).toEqual([root.id]);
    const files = drive.backupFiles().filter((f) => f.name === 'Rendicion_Global_2026-10-30.xlsx');
    expect(files).toHaveLength(1);
    expect(files[0].parents).toEqual([folder.id]);
    expect(drive.folders().some((f) => f.name === 'Proyectos')).toBe(false);
    expect(Object.keys(unzipSync(sent.bytes))).toContain('xl/worksheets/sheet2.xml');
    expect(download).not.toHaveBeenCalled();
    expect(await queue.list()).toHaveLength(0);
  });

  it('offline: parked at once as a global row (no project), nothing is sent or downloaded; the same day replaces it', async () => {
    const upload = vi.fn();
    for (let i = 0; i < 2; i += 1) {
      const out = await closeGlobalRendition({ projects: [a, b], totals: totalsOf(a, b), i18n, now: NOW, online: () => false, ...deps(), upload });
      expect(out).toEqual({ status: 'queued', reason: 'offline' });
    }
    expect(upload).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    const rows = await queue.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'global', projectId: '', fileName: 'Rendicion_Global_2026-10-30.xlsx', status: 'pending' });
  });

  it('a global row does not collide with a project row and removing a project keeps the global one', async () => {
    await closeGlobalRendition({ projects: [a], totals: totalsOf(a), i18n, now: NOW, online: () => false, ...deps() });
    await closeRendition({ project: a, totals: totalsOf(a), i18n, now: NOW, online: () => false, ...deps() });
    expect((await queue.list()).map((r) => r.kind).sort()).toEqual(['global', 'project']);
    await queue.removeProject(a.id);
    expect((await queue.list()).map((r) => r.kind)).toEqual(['global']);
  });

  it('the background drain routes each row to its own folder', async () => {
    await closeGlobalRendition({ projects: [a, b], totals: totalsOf(a, b), i18n, now: NOW, online: () => false, ...deps() });
    await closeRendition({ project: a, totals: totalsOf(a), i18n, now: NOW, online: () => false, ...deps() });
    const res = await drainExportQueue({ queue, upload: deps().upload, ensureToken: async () => 'tok', online: () => true });
    expect(res.done).toHaveLength(2);
    const parentOf = (name) => drive.folders().find((f) => f.id === drive.backupFiles().find((x) => x.name === name).parents[0]).name;
    expect(parentOf('Rendicion_Global_2026-10-30.xlsx')).toBe('Rendiciones_Globales');
    expect(parentOf('Rendicion_2026-10-30.xlsx')).toBe('Uno');
    expect(await queue.list()).toHaveLength(0);
  });

  it('Drive not configured: nothing is parked and nothing is downloaded', async () => {
    const out = await closeGlobalRendition({ projects: [a], totals: totalsOf(a), i18n, now: NOW, online: () => true, configured: false, ...deps() });
    expect(out).toEqual({ status: 'not_configured' });
    expect(download).not.toHaveBeenCalled();
  });
});
