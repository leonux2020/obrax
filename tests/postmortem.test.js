// @vitest-environment happy-dom
// (1) the device's BACK button (popstate) leaves the project exactly like the "←" arrow, (2) the read-only Post-Mortem of a
// finished project, (3) "Crear extensión": a new linked project (parentId) that copies client, place and market only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import App, { resetBoot } from '../src/App.jsx';
import { useHistoryBack } from '../src/lib/useHistoryBack.js';
import { projectStore, createProjectStore, idbProjectBackend } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject, newExtension, normalizeProject, rootId, toDayString, isClosed } from '../src/lib/projects.js';
import { postMortem, actualDays, estimatedDays } from '../src/lib/postMortem.js';
import { DB_VERSION } from '../src/lib/db.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};

let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(10);
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pop = async () => {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await flush(10);
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  window.history.replaceState(null, '');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---- 1. hardware back ----------------------------------------------------------------------------------------------------------
describe('useHistoryBack', () => {
  function Probe({ onLeave }) {
    const [id, setId] = useState(null);
    useHistoryBack(id, () => {
      onLeave();
      setId(null); // like the app: leaving = closing the project
    });
    return React.createElement(
      'div',
      null,
      React.createElement('button', { 'data-testid': 'open-a', onClick: () => setId('proyectoaaa') }),
      React.createElement('button', { 'data-testid': 'open-b', onClick: () => setId('proyectobbb') }),
      React.createElement('button', { 'data-testid': 'close', onClick: () => setId(null) }),
      React.createElement('span', { 'data-testid': 'id' }, id ?? '')
    );
  }
  const mountProbe = async (onLeave) => {
    await act(async () => {
      root.render(React.createElement(Probe, { onLeave }));
    });
  };

  it('opening a project pushes ONE entry; the device back button (popstate) calls onLeave once', async () => {
    const onLeave = vi.fn();
    await mountProbe(onLeave);
    const before = window.history.length;
    await click(q('open-a'));
    expect(window.history.state).toEqual({ cubraxProject: 'proyectoaaa' });
    expect(window.history.length).toBe(before + 1);
    await pop();
    expect(onLeave).toHaveBeenCalledTimes(1);
    await pop(); // no project open any more: nothing to do (the browser's own back goes on as usual)
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('opening another project from inside one re-labels the entry (history does not pile up)', async () => {
    await mountProbe(vi.fn());
    await click(q('open-a'));
    const length = window.history.length;
    await click(q('open-b'));
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ cubraxProject: 'proyectobbb' });
  });

  it('closing from the app (the arrow) pops the entry it pushed and that pop is NOT taken for a back press', async () => {
    const onLeave = vi.fn();
    const back = vi.spyOn(window.history, 'back');
    await mountProbe(onLeave);
    await click(q('open-a'));
    await click(q('close'));
    expect(back).toHaveBeenCalledTimes(1);
    await pop(); // the popstate that history.back() produces
    await flush(20);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('a stale marker left by a reload is cleared (the app never "backs" out of itself at start-up)', async () => {
    window.history.replaceState({ cubraxProject: 'proyectoaaa' }, '');
    const back = vi.spyOn(window.history, 'back');
    await mountProbe(vi.fn());
    expect(window.history.state).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });
});

// ---- the real App --------------------------------------------------------------------------------------------------------------
async function mountApp() {
  resetBoot();
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
  });
}
/** Finished jobs live in the Historial tab of the Dashboard. */
const openHistory = () => click(q('tab-history'));
const seed = async (projects = []) => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
  for (const p of projects) await projectStore.save(p);
};

/** A finished job in Mexico (another market than the app's CL): 10 estimated days, 6 real ones in the logbook. */
const finished = (extra = {}) => {
  const p = newProject({ regionCode: 'MX', name: 'Casa Soto', client: 'Luis Soto', startDate: '2026-03-02', endDate: '2026-03-11', location: { lat: 19.4326, lng: -99.1332, label: 'CDMX' } });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  return {
    ...p,
    closedAt: at(2026, 3, 20),
    payments: [{ id: 'pay001', amount: 40000, at: at(2026, 3, 3), note: 'Anticipo' }],
    advances: [{ id: 'adv001', worker: 'Juan', amount: 3000, at: at(2026, 3, 5) }],
    expenses: [{ id: 'exp001', at: at(2026, 3, 6), supplier: 'Home Depot', description: 'Taladro', amount: 5000, category: 'tool_rental', returnDate: '', returned: true }],
    logbook: [
      { id: 'log002', at: at(2026, 3, 8), text: 'Se coló la losa' },
      { id: 'log001', at: at(2026, 3, 3), text: 'Inicio de obra' },
    ],
    ...extra,
  };
};

describe('device back button inside the real App', () => {
  it('back (popstate) from a project goes to the Dashboard exactly like the arrow; at the Dashboard it does nothing', async () => {
    await seed();
    await mountApp();
    await pop(); // Dashboard: nothing to leave
    expect(q('fab-new')).not.toBeNull();
    await click(q('fab-new'));
    await typeInto(document.querySelector('[role="dialog"] input'), 'Casa Soto');
    await click(q('project-save'));
    expect(q('project-workspace')).not.toBeNull();
    expect(window.history.state?.cubraxProject).toBeTruthy(); // one entry for the open project
    await pop();
    expect(q('project-workspace')).toBeNull();
    expect(q('project-card')).not.toBeNull(); // same place the arrow leads to
    await flush(300);
    expect((await projectStore.load())[0].draft.project.name).toBe('Casa Soto'); // and it was saved on the way out
    // the arrow still works and leaves no entry behind
    await click(q('project-card'));
    expect(window.history.state?.cubraxProject).toBeTruthy();
    await click(q('ws-back'));
    expect(q('project-workspace')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('back with a sheet open over the project closes ONLY the sheet (LIFO); a second back lands on the Dashboard', async () => {
    await seed();
    await mountApp();
    await click(q('fab-new'));
    await typeInto(document.querySelector('[role="dialog"] input'), 'Casa Soto');
    await click(q('project-save'));
    await click(q('ws-edit'));
    expect(q('edit-form')).not.toBeNull();
    await pop();
    expect(q('edit-form')).toBeNull();
    expect(q('ws-title')).not.toBeNull(); // the project is still open under the closed sheet
    await pop();
    expect(q('project-workspace')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });
});

// ---- 2. post-mortem ------------------------------------------------------------------------------------------------------------
describe('postMortem model', () => {
  it('balance: budgeted vs collected vs real profit (collected - expenses - advances), margin and pending', () => {
    const pm = postMortem(finished(), { total: 100000 });
    expect(pm).toMatchObject({ budget: 100000, collected: 40000, pending: 60000, expenses: 5000, advances: 3000, spent: 8000, profit: 32000 });
    expect(pm.collectedPct).toBe(40);
    expect(pm.margin).toBeCloseTo(80, 5);
    const none = postMortem(finished({ payments: [] }), { total: 0 });
    expect(none).toMatchObject({ budget: 0, collected: 0, profit: -8000, margin: null });
    expect(postMortem(finished({ payments: [{ id: 'pay009', amount: 120000, at: 1, note: '' }] }), { total: 100000 }).overpaid).toBe(true);
  });

  it('time: estimated = the project dates; real = first to last logbook day (both included); no notes -> start to closing', () => {
    const p = finished();
    expect(estimatedDays(p, null)).toBe(10);
    expect(actualDays(p)).toEqual({ days: 6, source: 'log' });
    const pm = postMortem(p, { total: 1 });
    expect(pm.days).toMatchObject({ estimated: 10, actual: 6, delta: -4, source: 'log' });
    const quiet = postMortem({ ...p, logbook: [] }, { total: 1 });
    expect(quiet.days).toMatchObject({ actual: 19, source: 'dates', delta: 9 }); // 2 Mar -> 20 Mar
    expect(estimatedDays({ startDate: '', endDate: '' }, { schedule: { totals: { totalDays: 4.2 } } })).toBe(5); // the plan of the quote
    expect(estimatedDays({ startDate: '', endDate: '' }, null)).toBeNull();
    expect(actualDays({ logbook: [], startDate: '', createdAt: 0, closedAt: 0 })).toEqual({ days: null, source: 'none' });
  });
});

describe('Post-Mortem screen', () => {
  it('a finished project does NOT open the living list: a read-only dashboard with the balance, the times, the items and the notes', async () => {
    await seed([finished()]);
    await mountApp();
    await openHistory();
    await click(q('project-card'));
    expect(q('project-postmortem')).not.toBeNull();
    expect(q('project-workspace')).toBeNull();
    expect(q('ws-title').textContent).toBe('Casa Soto');
    expect(q('pm-closed').textContent).toContain('Finalizado');
    // ZERO inputs, sliders, numpad
    expect(document.querySelectorAll('input, textarea, select, [type="range"], [role="slider"]')).toHaveLength(0);
    expect(q('price-numpad')).toBeNull();
    expect(q('rent-pad')).toBeNull();
    expect(qa('locked-shield')).toHaveLength(0);
    // balance
    expect(q('pm-budget').textContent).toMatch(/\d/);
    expect(q('pm-collected').textContent).toMatch(/40[.,]000/);
    expect(q('pm-spent').textContent).toMatch(/8[.,]000/);
    expect(q('pm-profit').textContent).toMatch(/32[.,]000/);
    // times
    expect(q('pm-days-est').textContent).toBe('10');
    expect(q('pm-days-act').textContent).toBe('6');
    expect(q('pm-delta').dataset.delta).toBe('-4');
    expect(q('pm-delta').textContent).toContain('antes de lo estimado');
    // items + notes (read only, newest first)
    expect(q('pm-items').textContent).toMatch(/Cemento|Losa|Radier|Hormig/i);
    const notes = q('pm-log').querySelectorAll('li');
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toContain('Se coló la losa');
    expect(notes[1].textContent).toContain('Inicio de obra');
  });

  it('only buttons: back, export, reopen and create extension; reopening brings the living list back', async () => {
    await seed([finished()]);
    await mountApp();
    await openHistory();
    await click(q('project-card'));
    expect(window.history.state?.cubraxProject).toBeTruthy();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(q('pm-reopen'));
    expect(q('project-postmortem')).toBeNull();
    expect(q('project-workspace')).not.toBeNull();
    await flush(300);
    const [saved] = await projectStore.load();
    expect(isClosed(saved)).toBe(false);
    expect(saved.payments).toHaveLength(1); // nothing else changed
    // and the arrow of the workspace leaves it (the job is active again: it is in the active tab now)
    await click(q('ws-back'));
    await click(q('tab-active'));
    expect(q('project-card')).not.toBeNull();
  });

  it('i18n: the pm.* keys exist in six languages with the same parameters', () => {
    const keys = Object.keys(DICT.es).filter((k) => k.startsWith('pm.'));
    expect(keys.length).toBeGreaterThanOrEqual(25);
    for (const l of ['en', 'pt', 'fr', 'it', 'de']) {
      for (const k of keys) {
        expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
        expect((DICT[l][k].match(/\{\w+\}/g) || []).sort()).toEqual((DICT.es[k].match(/\{\w+\}/g) || []).sort());
      }
    }
  });
});

// ---- 3. extensions -------------------------------------------------------------------------------------------------------------
describe('newExtension + parentId (pure)', () => {
  it('copies ONLY client, place and market; no items, no money; linked to the original; numbered', () => {
    const parent = finished();
    const ext = newExtension(parent, [parent]);
    expect(ext.draft.project).toEqual({ name: 'Casa Soto - Extensión 1', client: 'Luis Soto' });
    expect(ext.location).toEqual(parent.location);
    expect(ext.draft.regionCode).toBe('MX');
    expect(ext.parentId).toBe(parent.id);
    expect(ext.draft.partidas).toEqual([]);
    expect(ext).toMatchObject({ payments: [], advances: [], expenses: [], logbook: [], closedAt: 0 });
    expect(ext.id).not.toBe(parent.id);
    expect(ext.startDate).toBe(toDayString(new Date()));
    expect(ext.endDate).toBe('');
    // the original is not touched
    expect(parent.payments).toHaveLength(1);
    expect(parent.draft.partidas).toHaveLength(1);
  });

  it('the next free number; an extension of an extension links to the ORIGINAL and keeps its name; names stay within 60 chars', () => {
    const parent = finished();
    const e1 = newExtension(parent, [parent]);
    const e2 = newExtension(parent, [parent, e1]);
    expect(e2.draft.project.name).toBe('Casa Soto - Extensión 2');
    const e3 = newExtension({ ...e1, closedAt: 1 }, [parent, e1, e2]);
    expect(e3.parentId).toBe(parent.id);
    expect(rootId(e3)).toBe(parent.id);
    expect(e3.draft.project.name).toBe('Casa Soto - Extensión 3');
    const long = finished();
    long.draft.project.name = 'N'.repeat(60);
    expect(newExtension(long, [long]).draft.project.name.length).toBeLessThanOrEqual(60);
    expect(newExtension(long, [long]).draft.project.name.endsWith(' - Extensión 1')).toBe(true);
    expect(newExtension(parent, [parent], { label: 'Extension' }).draft.project.name).toBe('Casa Soto - Extension 1');
  });

  it('parentId survives validation, is dropped when junk, and older records without it still load', () => {
    const parent = finished();
    const ext = newExtension(parent, [parent]);
    expect(normalizeProject(ext).parentId).toBe(parent.id);
    expect(normalizeProject({ ...ext, parentId: '<script>' }).parentId).toBeUndefined();
    expect(normalizeProject({ ...ext, parentId: 42 }).parentId).toBeUndefined();
    expect('parentId' in normalizeProject(parent)).toBe(false);
    expect('parentId' in newProject({ regionCode: 'CL' })).toBe(false);
  });

  it('IndexedDB: the field is stored and read back; the schema version does not need to change; older rows load', async () => {
    expect(DB_VERSION).toBe(6);
    const factory = new IDBFactory();
    const store = createProjectStore(idbProjectBackend(factory));
    const parent = finished();
    const ext = newExtension(parent, [parent]);
    await store.save(parent);
    await store.save(ext);
    const loaded = await createProjectStore(idbProjectBackend(factory)).load();
    expect(loaded.find((p) => p.id === ext.id).parentId).toBe(parent.id);
    expect(loaded.find((p) => p.id === parent.id).parentId).toBeUndefined();
    expect(loaded.find((p) => p.id === parent.id).payments).toHaveLength(1);
  });
});

describe('"Crear extensión" inside the app', () => {
  it('creates a NEW persisted project linked by parentId (client, place and country copied, no items) and opens it; the finished one is untouched', async () => {
    const parent = finished();
    await seed([parent]);
    await mountApp();
    await openHistory();
    await click(q('project-card'));
    const button = q('pm-extension');
    expect(button.textContent).toContain('Crear extensión');
    expect(button.className).toContain('border-brand');
    expect(button.className).toContain('text-brand');
    expect(button.className).toContain('bg-black');
    expect(button.className).toContain('min-h-[64px]');
    await click(button);
    expect(q('project-postmortem')).toBeNull();
    expect(q('project-workspace')).not.toBeNull(); // the new phase opens in the living list
    expect(q('ws-title').textContent).toBe('Casa Soto - Extensión 1');
    expect(q('ws-market').dataset.region).toBe('MX'); // the market of the original, not the app's CL
    expect(q('ws-location').textContent).toBe('CDMX');
    expect(q('partida-0')).toBeNull(); // no items
    await flush(400);
    const all = await projectStore.load();
    expect(all).toHaveLength(2);
    const ext = all.find((p) => p.parentId);
    expect(ext).toMatchObject({ parentId: parent.id, closedAt: 0 });
    expect(ext.draft.project).toEqual({ name: 'Casa Soto - Extensión 1', client: 'Luis Soto' });
    expect(ext.draft.regionCode).toBe('MX');
    expect(ext.draft.partidas).toEqual([]);
    expect(ext.location).toMatchObject({ lat: 19.4326, lng: -99.1332 });
    const original = all.find((p) => p.id === parent.id);
    expect(original.closedAt).toBe(parent.closedAt);
    expect(original.payments).toEqual(parent.payments);
    expect(original.logbook).toHaveLength(2);
    // back to the Dashboard (device button) and open the extension's original again: it still reads as finished; a 2nd extension is number 2
    await pop();
    await click(q('tab-active'));
    expect(qa('project-card')).toHaveLength(1); // the extension is an active job
    expect(qa('project-card')[0].textContent).toContain('Extensión 1');
    await openHistory();
    await click(q('project-card')); // the original, still finished
    expect(q('project-postmortem')).not.toBeNull();
    await click(q('pm-extension'));
    expect(q('ws-title').textContent).toBe('Casa Soto - Extensión 2');
  });

  it('an extension that gets finished shows "Extensión de …" in its post-mortem', async () => {
    const parent = finished();
    const ext = { ...newExtension(parent, [parent]), closedAt: at(2026, 5, 1) };
    await seed([parent, ext]);
    await mountApp();
    await openHistory();
    const card = qa('project-card').find((c) => c.textContent.includes('Extensión'));
    await click(card);
    expect(q('pm-parent').textContent).toContain('Casa Soto');
  });
});
