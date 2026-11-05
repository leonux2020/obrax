// @vitest-environment happy-dom
// Three frictions of the crew omnibox: the drop-up must be visible the moment one letter is typed, OLD workers (plain names, no id) must never
// break or vanish from the search, and the distance chips use REAL maths (Haversine between the job's point and the worker's lat / lon).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import WorkerSheet from '../src/components/squadra/WorkerSheet.jsx';
import { newProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { normalizeCrew } from '../src/lib/ledger.js';
import { LOCAL_KM, REGIONAL_KM, distanceKm, proximity, rankWorkers } from '../src/lib/crewMatch.js';
import { WORKERS_KEY, adaptLegacyWorker, cleanWorkerCoords, loadWorkers, normalizeWorker, saveWorkers } from '../src/lib/workers.js';
import { haversineKm } from '../src/lib/geoDistance.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const here = path.dirname(fileURLToPath(import.meta.url));

// Santiago de Chile is the job; the others are real places at a known distance
const JOB = { cityOrRegion: 'Santiago', location: { lat: -33.4489, lng: -70.6693, label: 'Santiago' } };
const MAIPU = { lat: -33.5106, lon: -70.7561 }; // ~12 km
const RANCAGUA = { lat: -34.1708, lon: -70.7444 }; // ~81 km
const VALPO = { lat: -33.0472, lon: -71.6127 }; // ~100 km
const CONCE = { lat: -36.8201, lon: -73.0444 }; // ~420 km
const DIR = [
  { id: 'wk000001', name: 'Ana Ruiz', specialties: ['electrician'], rating: 3, city: 'Maipú', ...MAIPU },
  { id: 'wk000002', name: 'Beto Soto', specialties: ['plumber'], rating: 5, city: 'Rancagua', ...RANCAGUA },
  { id: 'wk000003', name: 'Carla Díaz', specialties: ['plumber'], rating: 4, city: 'Valparaíso', ...VALPO },
  { id: 'wk000004', name: 'Dante Mora', specialties: ['mason'], rating: 5, city: 'Concepción', ...CONCE },
  { id: 'wk000005', name: 'Eva Lara', specialties: ['mason'], rating: 4 }, // no coordinates, no city: never invisible in the global search
  { id: 'wk000006', name: 'Fabio Vega', specialties: ['painter'], rating: 2, city: 'Santiago' }, // no coordinates but the town is the job's: name fallback
];

describe('Haversine: the distance chips are real maths', () => {
  it('the points of the test are where they claim to be', () => {
    const km = (w) => haversineKm({ lat: JOB.location.lat, lng: JOB.location.lng }, { lat: w.lat, lng: w.lon });
    expect(km(MAIPU)).toBeGreaterThan(8);
    expect(km(MAIPU)).toBeLessThan(18);
    expect(km(RANCAGUA)).toBeGreaterThan(LOCAL_KM);
    expect(km(RANCAGUA)).toBeLessThan(REGIONAL_KM);
    expect(km(VALPO)).toBeGreaterThan(LOCAL_KM);
    expect(km(VALPO)).toBeLessThan(REGIONAL_KM);
    expect(km(CONCE)).toBeGreaterThan(REGIONAL_KM);
  });
  it('distanceKm reads project.location {lat,lng} and worker {lat,lon}; null when either side lacks coordinates', () => {
    expect(distanceKm(JOB, DIR[0])).toBeCloseTo(haversineKm({ lat: -33.4489, lng: -70.6693 }, { lat: -33.5106, lng: -70.7561 }), 5);
    expect(distanceKm({ cityOrRegion: 'Santiago' }, DIR[0])).toBeNull();
    expect(distanceKm(JOB, DIR[4])).toBeNull();
    expect(distanceKm(JOB, undefined)).toBeNull();
    expect(distanceKm(null, DIR[0])).toBeNull();
  });
  it('proximity by kilometres: <= 70 local, <= 250 regional, beyond elsewhere', () => {
    expect([0, 1, 2, 3].map((i) => proximity(JOB, DIR[i]))).toEqual([0, 1, 1, 2]);
  });
  it('"Locale" only suggests workers within 70 km; "Regionale" widens to 250 km; "all" is everybody', () => {
    const names = (range) => rankWorkers(DIR, { project: JOB, range }).rows.map((r) => r.worker.name);
    // measured distances decide (Beto 81 km, Carla 100 km, Dante 420 km are out of "local"); the two without coordinates can not be measured: kept
    expect(names('local')).toEqual(['Ana Ruiz', 'Fabio Vega', 'Eva Lara']); // Maipú (12 km), the same town by name, and Eva (unknown, flagged)
    expect(names('regional')).toEqual(['Ana Ruiz', 'Fabio Vega', 'Beto Soto', 'Carla Díaz', 'Eva Lara']); // Dante (420 km) is out
    expect(names('all')).toHaveLength(6);
    expect(names('all')).toContain('Eva Lara'); // no coordinates, no city: still found in the global search
  });
  it('measured distances are exposed and, at the same level, the closer worker comes first', () => {
    const res = rankWorkers(DIR, { project: JOB, range: 'regional', query: '' });
    const ana = res.rows.find((r) => r.worker.name === 'Ana Ruiz');
    expect(ana.km).toBeGreaterThan(8);
    expect(res.rows.find((r) => r.worker.name === 'Fabio Vega').km).toBeNull();
    const regional = res.rows.filter((r) => r.near === 1).map((r) => r.worker.name);
    expect(regional).toEqual(['Beto Soto', 'Carla Díaz']); // 81 km before 100 km
  });
  it('a job without a saved point falls back to the place names; nobody unmeasurable is hidden, he is flagged "unknown"', () => {
    const named = { cityOrRegion: 'Maipú' };
    const res = rankWorkers(DIR, { project: named, range: 'local' });
    expect(res.rows).toHaveLength(6); // no point in the job: nobody can be measured, nobody is hidden
    expect(res.rows[0].worker.name).toBe('Ana Ruiz'); // ...but the town of the job is still first
    expect(res.rows.find((r) => r.worker.name === 'Dante Mora').unknown).toBe(true);
    expect(res.rows.find((r) => r.worker.name === 'Ana Ruiz').unknown).toBe(false);
    expect(rankWorkers(DIR, { project: JOB, range: 'local' }).hidden).toBe(0);
  });
  it('a located job with no city text is still "placed"', () => {
    expect(rankWorkers(DIR, { project: { location: { lat: -33.4489, lng: -70.6693, label: '' } }, range: 'local' }).placed).toBe(true);
  });
  it('coordinates of a worker: believable pairs only, ~10 m, otherwise nothing is stored', () => {
    expect(cleanWorkerCoords('-33.45678912', '-70.6')).toEqual({ lat: -33.4568, lon: -70.6 });
    for (const bad of [[null, 1], [91, 1], [1, 181], ['x', 1], ['', ''], [undefined, undefined]]) expect(cleanWorkerCoords(...bad)).toBeNull();
    expect(normalizeWorker({ name: 'A', lat: 'x', lon: 5 })).not.toHaveProperty('lat');
    expect(normalizeWorker({ name: 'A', lat: -33.4, lon: -70.6 })).toMatchObject({ lat: -33.4, lon: -70.6 });
    expect(normalizeWorker({ name: 'A', lat: -33.4, lng: -70.6 })).toMatchObject({ lon: -70.6 }); // `lng` is an old spelling
  });
});

describe('Legacy adapter: old workers never break or vanish', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('adaptLegacyWorker: plain strings, old spellings, a single `specialty`; never throws', () => {
    expect(adaptLegacyWorker('Juan Pérez')).toEqual({ name: 'Juan Pérez' });
    expect(adaptLegacyWorker({ nombre: 'Luis', ciudad: 'Talca', direccion: 'Calle 1', oficio: 'mason', worker_id: 'wk000009' })).toMatchObject({ name: 'Luis', city: 'Talca', address: 'Calle 1', specialties: ['mason'], id: 'wk000009' });
    for (const junk of [null, undefined, 5, [], true]) expect(adaptLegacyWorker(junk)).toBeNull();
    expect(normalizeWorker('Pedro')).toMatchObject({ name: 'Pedro', specialties: [], city: '', rating: 0 });
    expect(normalizeWorker({ name: 'Ana', specialty: 'painter' }).specialties).toEqual(['painter']);
    expect(normalizeWorker({ name: 'Ana', specialty: 'hacker' }).specialties).toEqual([]);
    expect(normalizeWorker({})).toBeNull();
  });
  it('plain-string workers of an old directory are loaded, given ONE stable id and written back (the id does not change between loads)', () => {
    localStorage.setItem(WORKERS_KEY, JSON.stringify(['Juan Pérez', { name: 'Marta Lopez', specialties: ['painter'] }, { name: 'Ana Ruiz', id: 'wk000001' }]));
    const first = loadWorkers();
    expect(first.map((w) => w.name)).toEqual(['Ana Ruiz', 'Juan Pérez', 'Marta Lopez']);
    const second = loadWorkers();
    expect(second.map((w) => w.id)).toEqual(first.map((w) => w.id)); // stable
    expect(JSON.parse(localStorage.getItem(WORKERS_KEY)).every((w) => typeof w === 'object' && w.id)).toBe(true);
  });
  it('an id-less row repeating a name is the same person: no duplicate; a row with its own id stays', () => {
    localStorage.setItem(WORKERS_KEY, JSON.stringify([{ name: 'Juan Pérez', id: 'wk000007' }, 'juan pérez', { name: 'Otro', id: 'wk000008' }]));
    expect(loadWorkers().map((w) => w.name)).toEqual(['Juan Pérez', 'Otro']);
  });
  it('corrupt storage never throws', () => {
    localStorage.setItem(WORKERS_KEY, '{not json');
    expect(loadWorkers()).toEqual([]);
    localStorage.setItem(WORKERS_KEY, '{"a":1}');
    expect(loadWorkers()).toEqual([]);
  });
  it('a crew written as plain names (or with `nombre` / `worker_id`) is read, not dropped', () => {
    const crew = normalizeCrew(['Pepe', { nombre: 'Lola', worker_id: 'wk000001' }, null, 7, { name: 'Ana', specialty: 'painter' }]);
    expect(crew.map((c) => c.name)).toEqual(['Pepe', 'Lola', 'Ana']);
    expect(crew[1].ref).toBe('wk000001');
    expect(crew.every((c) => c.id && c.specialty)).toBe(true);
  });
  it('rankWorkers tolerates a raw directory full of junk', () => {
    const rows = rankWorkers(['Solo Nombre', null, 3, { name: 'Con Ciudad', ciudad: 'Maipú' }, {}], { project: { cityOrRegion: 'Maipú' }, range: 'all', query: 'o' }).rows;
    expect(rows.map((r) => r.worker.name).sort()).toEqual(['Con Ciudad', 'Solo Nombre']);
  });
});

// ---- the screen ---------------------------------------------------------------------------------------------------------------
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
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
let projectNow;
function Harness({ initial }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  projectNow = project;
  return React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} });
}
const mount = async (extra = JOB) => {
  const project = { ...newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana' }), crew: [], ...extra };
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: project })));
  });
  await flush();
  await click(q('ws-crew'));
};

describe('the drop-up materializes with ONE letter', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRegistry();
    resetToasts();
    saveWorkers(DIR);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });

  it('one letter: the drop-up exists, sits ABOVE the dock, has its own stacking and an opaque dark background with light text', async () => {
    await mount();
    expect(q('crew-dropup')).toBeNull();
    await typeInto(q('crew-search'), 'a');
    const up = q('crew-dropup');
    expect(up).not.toBeNull();
    expect(q('crew-dock').contains(up)).toBe(true);
    expect(up.className).toContain('absolute');
    expect(up.className).toContain('bottom-full');
    expect(up.className).toContain('z-50');
    expect(up.className).toContain('bg-black');
    expect(up.className).toContain('text-neutral-100');
    expect(up.className).not.toContain('overflow-hidden');
    expect(q('crew-dock').className).toContain('relative');
    expect(q('crew-dock').className).toContain('z-50');
    expect(host.querySelectorAll('[data-testid^="crew-pick-wk"]').length).toBeGreaterThan(0);
  });
  it('no ancestor of the dock between it and the sheet can clip the list: the sheet itself has no overflow-hidden when it fills', async () => {
    await mount();
    await typeInto(q('crew-search'), 'a');
    let el = q('crew-dropup').parentElement;
    const clipping = [];
    while (el && el !== host) {
      if (/\boverflow-(hidden|clip)\b/.test(el.className || '')) clipping.push(el.className);
      el = el.parentElement;
    }
    expect(clipping).toEqual([]);
  });
  it('the sheet source keeps `fill` free of overflow-hidden (the drop-up is taller than the space left by the keyboard)', () => {
    const src = readFileSync(path.resolve(here, '../src/components/BottomSheet.jsx'), 'utf8');
    expect(src).not.toMatch(/fill \? '[^']*overflow-hidden/);
  });
  it('empty text: nothing; clearing the text closes it again', async () => {
    await mount();
    await typeInto(q('crew-search'), 'a');
    expect(q('crew-dropup')).not.toBeNull();
    await typeInto(q('crew-search'), '');
    expect(q('crew-dropup')).toBeNull();
  });
  it('each suggestion shows the real distance when both points are known', async () => {
    await mount();
    await click(q('crew-range-all'));
    await typeInto(q('crew-search'), 'ana');
    expect(q('crew-pick-wk000001').querySelector('[data-testid="crew-pick-note"]').textContent).toMatch(/Local \(\d+ km\)/);
    await typeInto(q('crew-search'), 'eva');
    expect(q('crew-pick-wk000005').querySelector('[data-testid="crew-pick-note"]').textContent).not.toMatch(/km/);
  });
  it('the "Local" chip really filters by kilometres and "Todos" brings back the rest', async () => {
    await mount();
    await typeInto(q('crew-search'), 'a');
    const ids = () => [...host.querySelectorAll('[data-testid^="crew-pick-wk"]')].map((b) => b.getAttribute('data-testid').replace('crew-pick-', ''));
    expect(ids()).toEqual(expect.arrayContaining(['wk000001', 'wk000006']));
    expect(ids()).not.toContain('wk000002'); // 81 km
    expect(ids()).not.toContain('wk000004'); // 420 km
    await click(q('crew-range-all'));
    expect(ids()).toEqual(expect.arrayContaining(['wk000003', 'wk000004', 'wk000005'])); // far away (100 / 420 km) or without coordinates: back in the global list
    await typeInto(q('crew-search'), 'beto');
    expect(ids()).toEqual(['wk000002']); // 81 km: regional, found by name in the global list
  });
  it('LEGACY: a plain-name directory and a plain-name crew render, search and add without crashing or duplicating', async () => {
    localStorage.setItem(WORKERS_KEY, JSON.stringify(['Juan Pérez', { name: 'Marta Lopez' }]));
    await mount({ cityOrRegion: '', location: null, crew: ['Marta Lopez', { name: 'Pepe' }] });
    expect(q('ws-crew-sheet')).not.toBeNull();
    await typeInto(q('crew-search'), 'j');
    expect(q('crew-dropup')).not.toBeNull();
    const names = [...host.querySelectorAll('[data-testid="crew-pick-name"]')].map((n) => n.textContent);
    expect(names).toEqual(['Juan Pérez']);
    await typeInto(q('crew-search'), 'marta');
    expect(host.querySelectorAll('[data-testid="crew-pick-name"]')).toHaveLength(0); // already on the job (by name): never offered twice
    expect(q('crew-pick-hint')).not.toBeNull();
    await typeInto(q('crew-search'), 'juan');
    const juan = host.querySelector('[data-testid^="crew-pick-wk"], [data-testid^="crew-pick-"][data-near]');
    await click(juan);
    expect(projectNow.crew.filter((c) => c.name === 'Juan Pérez')).toHaveLength(1);
    expect(projectNow.crew[projectNow.crew.length - 1].ref).toMatch(/^[a-z0-9]{4,24}$/);
  });
});

describe('Ajustes > worker file: city is separate from the address and saves its coordinates quietly', () => {
  const json = (body) => Promise.resolve(body);
  const PLACES = [{ id: 'p1', name: 'Rancagua', label: 'Rancagua, Chile', country: 'Chile', countryCode: 'CL', lat: -34.1708, lng: -70.7444 }];
  let saved;
  beforeEach(() => {
    saved = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const open = async (worker = null, search = vi.fn(() => json(PLACES))) => {
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(WorkerSheet, { worker, onSave: (w) => (saved = w), onClose: () => {}, search, searchDelay: 0 })));
    });
    await flush();
    if (worker) await click(q('worker-edit')); // an existing file opens as a read-only card; the pencil reveals the form
    return search;
  };
  const submit = () => act(async () => q('worker-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  it('two separate fields: city (autocomplete) and address (street)', async () => {
    await open();
    expect(q('worker-city')).not.toBeNull();
    expect(q('worker-address')).not.toBeNull();
    expect(q('worker-city')).not.toBe(q('worker-address'));
    expect(q('worker-city').getAttribute('role')).toBe('combobox');
    expect(q('worker-address').getAttribute('role')).toBeNull();
  });
  it('typing the town lists Nominatim matches; picking one writes the town and saves lat / lon without showing them', async () => {
    const search = await open();
    await typeInto(q('worker-name'), 'Beto Soto');
    await typeInto(q('worker-address'), 'Calle 5 #123');
    await typeInto(q('worker-city'), 'Ranca');
    await flush(5);
    expect(search).toHaveBeenCalled();
    expect(q('worker-city-results')).not.toBeNull();
    expect(q('worker-city-box').getAttribute('data-located')).toBe('false');
    await click(q('worker-city-option-0'));
    expect(q('worker-city').value).toBe('Rancagua');
    expect(q('worker-city-results')).toBeNull();
    expect(q('worker-city-box').getAttribute('data-located')).toBe('true');
    expect(q('worker-address').value).toBe('Calle 5 #123'); // the street is untouched
    await submit();
    expect(saved).toMatchObject({ name: 'Beto Soto', city: 'Rancagua', address: 'Calle 5 #123', lat: -34.1708, lon: -70.7444 });
  });
  it('typing the town by hand afterwards drops the old point (it would describe another place)', async () => {
    await open({ id: 'wk000002', name: 'Beto Soto', city: 'Rancagua', ...RANCAGUA });
    expect(q('worker-city-box').getAttribute('data-located')).toBe('true'); // an existing point survives opening the file
    await typeInto(q('worker-city'), 'Rancagu');
    expect(q('worker-city-box').getAttribute('data-located')).toBe('false');
    await submit();
    expect(saved.lat ?? null).toBeNull();
    expect(normalizeWorker(saved)).not.toHaveProperty('lat');
  });
  it('editing something else keeps the saved coordinates', async () => {
    await open({ id: 'wk000002', name: 'Beto Soto', city: 'Rancagua', ...RANCAGUA });
    await typeInto(q('worker-address'), 'Otra calle 9');
    await submit();
    expect(saved).toMatchObject({ lat: RANCAGUA.lat, lon: RANCAGUA.lon });
  });
  it('offline / failing search never blocks the form: the town can be typed and saved without coordinates', async () => {
    await open(null, vi.fn(() => Promise.reject(new Error('offline'))));
    await typeInto(q('worker-name'), 'Eva');
    await typeInto(q('worker-city'), 'Pueblo');
    await flush(5);
    expect(q('worker-city-results')).toBeNull();
    await submit();
    expect(saved).toMatchObject({ name: 'Eva', city: 'Pueblo' });
    expect(normalizeWorker(saved)).not.toHaveProperty('lat');
  });
});
