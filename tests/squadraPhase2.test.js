// @vitest-environment happy-dom
// "Zero Stress" phase 2: Squadra. The selector is an inline dropdown, the worker row is minimal (name, ⚠, birthday cake, advance), the
// header pencil replaces the x (the sheet closes only by Back / swipe) and the delete icons only exist in edit mode.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import { newProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';
import { isBirthdayToday, loadWorkers, saveWorkers } from '../src/lib/workers.js';
import { CLIENT, q as appQ, click as appClick, createHost, deviceBack } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pad = (n) => String(n).padStart(2, '0');
/** A (leap) year that always exists, with TODAY's local day and month. */
const todayBorn = (now = new Date()) => `1992-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const tomorrowBorn = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `1992-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('isBirthdayToday: day and month in the LOCAL calendar', () => {
  const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
  it('matches the day and month, whatever the year', () => {
    expect(isBirthdayToday('1990-11-04', at(2026, 11, 4))).toBe(true);
    expect(isBirthdayToday('2001-11-04', at(2026, 11, 4))).toBe(true);
    expect(isBirthdayToday('1990-11-05', at(2026, 11, 4))).toBe(false);
    expect(isBirthdayToday('1990-10-04', at(2026, 11, 4))).toBe(false);
  });
  it('uses the local clock, not UTC: the first and last minute of the day both count', () => {
    expect(isBirthdayToday('1990-11-04', new Date(2026, 10, 4, 0, 1))).toBe(true);
    expect(isBirthdayToday('1990-11-04', new Date(2026, 10, 4, 23, 59))).toBe(true);
    expect(isBirthdayToday('1990-11-04', new Date(2026, 10, 3, 23, 59))).toBe(false);
  });
  it('29 February is celebrated on the 28th in the years without one', () => {
    expect(isBirthdayToday('1992-02-29', at(2027, 2, 28))).toBe(true);
    expect(isBirthdayToday('1992-02-29', at(2027, 3, 1))).toBe(false);
    expect(isBirthdayToday('1992-02-29', at(2028, 2, 29))).toBe(true);
    expect(isBirthdayToday('1992-02-29', at(2028, 2, 28))).toBe(false);
  });
  it('nothing to celebrate with no / bad date', () => {
    for (const bad of ['', undefined, null, 'x', '15/06/1990', 5]) expect(isBirthdayToday(bad, at(2026, 6, 15))).toBe(false);
  });
  it('every language names the birthday and the edit toggle', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of ['squadra.birthday', 'crew.edit.on', 'crew.edit.done']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
  });
});

// ---- the crew sheet of a project ----------------------------------------------------------------------------------------------
let host;
let root;
let spy;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...host.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
function Harness({ initial }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} });
}
const DIRECTORY = [
  { id: 'wk000001', name: 'Ana Ruiz', specialties: ['electrician'], rating: 3, allergies: 'Penicilina', birthDate: todayBorn() },
  { id: 'wk000002', name: 'Beto Soto', specialties: ['plumber'], rating: 5, birthDate: tomorrowBorn() },
  { id: 'wk000003', name: 'Carla Díaz', specialties: ['mason'], rating: 4 },
];
const mount = async (extra = {}) => {
  spy = {};
  const project = { ...newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana' }), crew: [], ...extra };
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: project })));
  });
  await flush();
  await click(q('ws-crew'));
};
const typeSearch = (text) =>
  act(() => {
    const input = q('crew-search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pick = async (workerId) => {
  await click(q('crew-range-all'));
  await typeSearch(DIRECTORY.find((w) => w.id === workerId).name);
  await click(q(`crew-pick-${workerId}`));
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  saveWorkers(DIRECTORY);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('Squadra of a project: the unified selector', () => {
  it('picking a master from the live suggestions adds him / her at once to the simple list below and the suggestions fold away', async () => {
    await mount();
    await click(q('crew-range-all'));
    await typeSearch('carla');
    expect(q('crew-suggest')).not.toBeNull();
    await click(q('crew-pick-wk000003'));
    expect(q('crew-suggest')).toBeNull();
    expect(spy.project.crew).toHaveLength(1);
    expect(spy.project.crew[0]).toMatchObject({ name: 'Carla Díaz', ref: 'wk000003' });
    expect(q('crew-list').contains(q(`worker-${spy.project.crew[0].id}`))).toBe(true);
  });

  it('the structure of the sheet is the same in every project: control line, master search, list', async () => {
    const order = async (extra) => {
      await mount(extra);
      const ids = ['crew-bar', 'crew-master', 'crew-list'].filter((id) => q(id));
      act(() => root.unmount());
      root = createRoot(host);
      return ids;
    };
    const a = await order({ crew: [{ id: 'crew0001', name: 'Ana', specialty: 'multi' }] });
    const b = await order({ crew: [{ id: 'crew0001', name: 'Ana', specialty: 'multi' }], cityOrRegion: 'Maipú', startDate: '2026-01-01', endDate: '2026-02-01' });
    expect(a).toEqual(['crew-bar', 'crew-master', 'crew-list']);
    expect(b).toEqual(a);
  });
});

describe('Squadra of a project: the minimal row and the birthday', () => {
  it('only the name, the ⚠ and the advance button; the birthday cake shows only for the person whose birthday is TODAY', async () => {
    await mount();
    await pick('wk000001'); // Ana: birthday today + allergy
    await pick('wk000002'); // Beto: birthday tomorrow
    await pick('wk000003'); // Carla: no date
    const [ana, beto, carla] = spy.project.crew.map((w) => w.id);
    const cake = q(`worker-birthday-${ana}`);
    expect(cake).not.toBeNull();
    expect(cake.textContent).toBe('🎂');
    expect(cake.getAttribute('aria-label')).toBe(DICT.es['squadra.birthday']);
    expect(q(`worker-${ana}`).querySelector(`[data-testid="worker-name-${ana}"]`).compareDocumentPosition(cake) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // next to the name
    expect(q(`worker-health-${ana}`)).not.toBeNull();
    expect(q(`worker-birthday-${beto}`)).toBeNull();
    expect(q(`worker-birthday-${carla}`)).toBeNull();
    for (const id of [ana, beto, carla]) {
      expect([...q(`worker-${id}`).querySelectorAll('button')].map((b) => b.dataset.testid)).toEqual([`worker-toggle-${id}`, `worker-pay-${id}`]);
      expect(q(`worker-spec-${id}`)).toBeNull();
    }
  });

  it('a person added as plain text has no file, so no cake', async () => {
    await mount({ crew: [{ id: 'crew0001', name: 'Pedro', specialty: 'multi' }] });
    expect(q('worker-birthday-crew0001')).toBeNull();
  });

  it('the cake follows the live file of the directory', async () => {
    await mount({ crew: [{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001' }] });
    expect(q('worker-birthday-crew0001')).not.toBeNull();
  });
});

describe('Squadra of a project: protected edit mode', () => {
  it('the header has a floating pencil instead of the x; the sheet cannot be closed with a button, only by Back / backdrop / swipe', async () => {
    await mount();
    await pick('wk000003');
    const dialog = q('ws-crew-sheet').closest('[role="dialog"]');
    expect(dialog.querySelector('[data-sheet-close]')).toBeNull();
    expect(dialog.dataset.swipeClose).toBe('true');
    const toggle = q('crew-edit-toggle');
    expect(toggle.querySelector('svg[data-icon="pencil"]')).not.toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Editar lista');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(dialog.textContent).not.toContain('×');
  });

  it('delete icons are hidden by default; the pencil reveals them (a check while on); the delete needs a second tap', async () => {
    await mount();
    await pick('wk000003');
    await pick('wk000002');
    const [carla, beto] = spy.project.crew.map((w) => w.id);
    expect(q(`worker-del-${carla}`)).toBeNull();
    await click(q('crew-edit-toggle'));
    expect(q('crew-edit-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(q('crew-edit-toggle').querySelector('svg[data-icon="check"]')).not.toBeNull();
    expect(q(`worker-del-${carla}`)).not.toBeNull();
    expect(q(`worker-del-${beto}`)).not.toBeNull();
    await click(q(`worker-del-${carla}`));
    expect(spy.project.crew).toHaveLength(2); // one tap deletes nothing
    await click(q(`worker-del-${carla}-confirm`));
    expect(spy.project.crew.map((w) => w.id)).toEqual([beto]);
    await click(q('crew-edit-toggle')); // leaving the mode hides them again
    expect(q(`worker-del-${beto}`)).toBeNull();
  });

  it('the edit mode is dropped when the sheet is closed (Back): it opens quiet again', async () => {
    await mount();
    await pick('wk000003');
    await click(q('crew-edit-toggle'));
    expect(q('crew-edit-toggle').getAttribute('aria-pressed')).toBe('true');
    await click(qa('sheet-backdrop').at(-1));
    expect(q('ws-crew-sheet')).toBeNull();
    await click(q('ws-crew'));
    expect(q('crew-edit-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(q(`worker-del-${spy.project.crew[0].id}`)).toBeNull();
  });

  it('an empty crew has nothing to edit: the pencil is disabled', async () => {
    await mount();
    expect(q('crew-edit-toggle').disabled).toBe(true);
  });
});

// ---- the global directory (Ajustes > Squadra) -----------------------------------------------------------------------------------
describe('Squadra directory: pencil, protected delete and the birthday', () => {
  let App;
  let h;
  beforeAll(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    App = (await import('../src/App.jsx')).default;
  });
  beforeEach(() => {
    sessionStorage.clear();
    clearDriveToken();
    window.history.replaceState(null, '');
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', phone: '', email: '' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    saveWorkers(DIRECTORY);
  });
  afterEach(() => h?.unmount());
  const open = async () => {
    h = createHost(App);
    await h.mount();
    await appClick(h.tab('Ajustes'));
    await appClick(appQ('settings-squadra'));
  };

  it('no x in the header (a pencil instead), closes with the device Back; the delete icons only appear in edit mode and need a second tap', async () => {
    await open();
    const dialog = appQ('squadra').closest('[role="dialog"]');
    expect(dialog.querySelector('[data-sheet-close]')).toBeNull();
    expect(appQ('squadra-edit-toggle').querySelector('svg[data-icon="pencil"]')).not.toBeNull();
    expect(appQ('worker-del-wk000003')).toBeNull();
    await appClick(appQ('squadra-edit-toggle'));
    expect(appQ('worker-del-wk000003')).not.toBeNull();
    await appClick(appQ('worker-del-wk000003'));
    expect(loadWorkers()).toHaveLength(3);
    await appClick(appQ('worker-del-wk000003-confirm'));
    expect(loadWorkers().map((w) => w.id)).toEqual(['wk000001', 'wk000002']);
    expect(appQ('worker-wk000003')).toBeNull();
    await deviceBack();
    expect(appQ('squadra')).toBeNull();
    expect(appQ('settings-view')).not.toBeNull();
  });

  it('the cake shows next to the name of whoever has their birthday today', async () => {
    await open();
    expect(appQ('worker-wk000001').querySelector('[data-testid="worker-birthday"]')).not.toBeNull();
    expect(appQ('worker-wk000002').querySelector('[data-testid="worker-birthday"]')).toBeNull();
    expect(appQ('worker-wk000003').querySelector('[data-testid="worker-birthday"]')).toBeNull();
  });
});

// ---- global rule: the edit pencil is a floating icon, never a box ---------------------------------------------------------------
describe('every pencil button of the source is a clean floating icon', () => {
  it('no border, bg-neutral, ring or shadow on a button that holds the pencil', async () => {
    const { execSync } = await import('node:child_process');
    const files = execSync("grep -rlE 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19' src --include=*.jsx", { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(3);
    const BOX = /(^|[\s"'`{])(border(?!-transparent)\b|bg-neutral-|ring\b|ring-|shadow\b|shadow-)/;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      let i = src.indexOf('M16.5 3.5a2.1');
      while (i !== -1) {
        const start = src.lastIndexOf('<button', i);
        if (start !== -1) {
          const tag = src.slice(start, i);
          const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag);
          if (cls) expect(BOX.test(cls[1] ?? cls[2]), `${f}: ${cls[1] ?? cls[2]}`).toBe(false);
        }
        i = src.indexOf('M16.5 3.5a2.1', i + 1);
      }
    }
  });
  it('the floating style is the neutral-400 -> white one', () => {
    const src = readFileSync('src/components/EditControls.jsx', 'utf8');
    expect(src).toContain('text-neutral-400 hover:text-white');
    for (const f of ['src/components/workspace/HeaderZone.jsx', 'src/components/workspace/LogBlock.jsx']) expect(readFileSync(f, 'utf8'), f).toContain('text-neutral-400 transition hover:text-white');
  });
});
