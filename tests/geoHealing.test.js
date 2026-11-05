// @vitest-environment happy-dom
// "El trabajador a 20 km SIGUE sin aparecer en Locale": (1) the maths is audited in km with the hard case Santiago -> Maipú (~11 km),
// (2) silent healing: a job / worker typed by hand (city name, no point) is geocoded in the background and measured, (3) zero stress: when the
// distance is impossible to know nobody is hidden, he is listed as "Distancia desconocida".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import { newProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { LOCAL_KM, distanceKm, hasPoint, proximity, rankWorkers } from '../src/lib/crewMatch.js';
import { haversineKm } from '../src/lib/geoDistance.js';
import { HEAL_MAX_WORKERS, healTargets, pickPlace } from '../src/lib/useGeoHealing.js';
import { saveWorkers } from '../src/lib/workers.js';
import { DICT } from '../src/lib/dict.js';
import { normalizeLocation } from '../src/lib/ledger.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const here = path.dirname(fileURLToPath(import.meta.url));

const SANTIAGO = { lat: -33.4489, lng: -70.6693 };
const MAIPU = { lat: -33.5101, lng: -70.7588 };

describe('1) the maths: kilometres, radians, the hard case', () => {
  it('HARD TEST: Santiago -> Maipú is ~11 km (not 11 000 m, not NaN) and passes "<= 70"', () => {
    const km = haversineKm(SANTIAGO, MAIPU);
    expect(Number.isFinite(km)).toBe(true);
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(12);
    expect(km <= LOCAL_KM).toBe(true);
    // through the whole pipeline: project point + worker point (strings, as Nominatim sends them)
    const d = distanceKm({ location: { lat: '-33.4489', lng: '-70.6693' } }, { lat: '-33.5101', lon: '-70.7588' });
    expect(d).toBeCloseTo(km, 6);
    expect(proximity({ location: SANTIAGO }, { lat: MAIPU.lat, lon: MAIPU.lng })).toBe(0);
  });
  it('known distances: 1 degree of latitude = 111.2 km (radius 6371 km, radians), a quarter of the globe = 10 007 km, same point = 0', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 0);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 90, lng: 0 })).toBeCloseTo(10007.5, 0);
    expect(haversineKm({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0);
    expect(haversineKm({ lat: -33.4489, lng: -70.6693 }, { lat: -33.0472, lng: -71.6127 })).toBeGreaterThan(95); // Santiago - Valparaíso ~100 km
    expect(haversineKm({ lat: -33.4489, lng: -70.6693 }, { lat: -33.0472, lng: -71.6127 })).toBeLessThan(105);
  });
  it('the source: degrees are turned into radians BEFORE sin / cos, the radius is in km, and the answer is not multiplied by 1000', () => {
    const src = readFileSync(path.resolve(here, '../src/lib/geoDistance.js'), 'utf8');
    expect(src).toMatch(/const rad = \(deg\) => \(deg \* Math\.PI\) \/ 180/);
    expect(src).toMatch(/EARTH_RADIUS_KM = 6371/);
    const body = src.slice(src.indexOf('export function haversineKm'), src.indexOf('/** Is `point` within'));
    expect(body).not.toMatch(/1000/); // no metres anywhere in the formula
    expect(src).toMatch(/Math\.sin\(dLat \/ 2\)/);
    expect(src).toMatch(/rad\(q\.lat - p\.lat\)/);
  });
  it('0,0 is an empty record, not a place; hasPoint knows', () => {
    expect(hasPoint({ lat: 0, lng: 0 })).toBe(false);
    expect(hasPoint({ lat: '0', lon: '0' })).toBe(false);
    expect(hasPoint({ lat: null, lng: null })).toBe(false);
    expect(hasPoint({ lat: '', lng: '' })).toBe(false);
    expect(hasPoint({ lat: 0, lng: -70 })).toBe(true); // the equator is a place
    expect(hasPoint(SANTIAGO)).toBe(true);
    expect(normalizeLocation({ lat: 0, lng: 0 })).toBeNull();
    // a worker "at 0,0" is NOT 6 000 km away: he is unmeasured, never excluded
    const res = rankWorkers([{ id: 'wk000001', name: 'Cero', city: 'Maipú', lat: 0, lon: 0 }], { project: { cityOrRegion: 'Santiago', location: { ...SANTIAGO, label: 'Santiago' } }, range: 'local' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].km).toBeNull();
    expect(res.rows[0].unknown).toBe(true);
  });
});

describe('3) zero stress: a distance that cannot be known never hides anybody', () => {
  const job = { cityOrRegion: 'Santiago', location: { ...SANTIAGO, label: 'Santiago' } };
  it('measured far = out of Locale; unmeasurable = in, flagged unknown; measured near = in, with its km', () => {
    const dir = [
      { id: 'wk000001', name: 'Cerca', lat: MAIPU.lat, lon: MAIPU.lng, city: 'Maipú' },
      { id: 'wk000002', name: 'Lejos', lat: -36.82, lon: -73.04, city: 'Concepción' },
      { id: 'wk000003', name: 'Sin datos', city: 'Pueblo', lat: null, lon: '' },
      { id: 'wk000004', name: 'Sin nada' },
    ];
    const rows = rankWorkers(dir, { project: job, range: 'local' }).rows;
    expect(rows.map((r) => r.worker.name)).toEqual(['Cerca', 'Sin datos', 'Sin nada']);
    expect(rows.map((r) => r.unknown)).toEqual([false, true, true]);
    expect(rows[0].km).toBeGreaterThan(10);
    expect(rows[0].km).toBeLessThan(12);
  });
  it('every language names it', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l]['crew.near.unknown'], l).toBeTruthy();
  });
});

describe('2) silent healing: the pure parts', () => {
  const dir = [
    { id: 'wk000001', name: 'Ana', city: 'Maipú' },
    { id: 'wk000002', name: 'Beto', city: 'Maipú' }, // same town: asked once
    { id: 'wk000003', name: 'Carla', city: 'Rancagua', lat: -34.17, lon: -70.74 }, // already has a point
    { id: 'wk000004', name: 'Dante' }, // no city: nothing to ask
    { id: 'wk000005', name: 'Eva', city: 'Talca', lat: 0, lon: 0 }, // 0,0 = missing
  ];
  it('targets: the job first (when it has a name but no point), then the towns of the workers the search shows, once each', () => {
    const t = healTargets({ project: { cityOrRegion: 'Santiago' }, directory: dir, query: '' });
    expect(t.map((x) => [x.kind, x.text])).toEqual([['project', 'Santiago'], ['worker', 'Maipú'], ['worker', 'Talca']]);
    expect(healTargets({ project: { cityOrRegion: 'Santiago', location: { ...SANTIAGO } }, directory: dir, query: 'ana' }).map((x) => x.text)).toEqual(['Maipú']);
    expect(healTargets({ project: { cityOrRegion: '' }, directory: [], query: '' })).toEqual([]);
    expect(healTargets({ project: null, directory: null, query: '' })).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `wk${String(100000 + i)}`, name: `P${i}`, city: `Pueblo${i}` }));
    expect(healTargets({ project: null, directory: many, query: '' })).toHaveLength(HEAL_MAX_WORKERS);
  });
  it('pickPlace: the nearest answer to the job when it is known, else the job country, else the first; junk is ignored', () => {
    const places = [
      { lat: -33.2, lng: -70.9, countryCode: 'CL' }, // Maipú, Chile
      { lat: -36.8, lng: -64.9, countryCode: 'AR' }, // Maipú, Argentina
    ];
    expect(pickPlace([places[1], places[0]], { near: SANTIAGO })).toBe(places[0]);
    expect(pickPlace(places, { countryCode: 'AR' })).toBe(places[1]);
    expect(pickPlace(places, {})).toBe(places[0]);
    expect(pickPlace([{ lat: 'x', lng: 1 }, null, { lat: 0, lng: 0 }], {})).toBeNull();
    expect(pickPlace(null, {})).toBeNull();
  });
});

// ---- the screen ---------------------------------------------------------------------------------------------------------------
let host;
let root;
let projectNow;
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
function Harness({ initial, geocode }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  projectNow = project;
  return React.createElement(ProjectWorkspace, { project, setProject, setDraft, geocode, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} });
}
const mount = async (geocode, extra) => {
  const project = { ...newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana' }), crew: [], ...extra };
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: project, geocode })));
  });
  await flush();
  await click(q('ws-crew'));
};
const ids = () => [...host.querySelectorAll('[data-testid^="crew-pick-wk"]')].map((b) => b.getAttribute('data-testid').replace('crew-pick-', ''));
const note = (id) => q(`crew-pick-${id}`).querySelector('[data-testid="crew-pick-note"]').textContent;

// a hand-typed job (a city name, no point) and workers typed by hand in the old days (a town name, no point)
const OLD_DIR = [
  { id: 'wk000001', name: 'Ana Cerca', specialties: ['electrician'], rating: 4, city: 'Maipú' },
  { id: 'wk000002', name: 'Ana Lejos', specialties: ['electrician'], rating: 5, city: 'Concepción' },
  { id: 'wk000003', name: 'Ana Perdida', specialties: ['electrician'], rating: 3, city: 'Villa Imaginaria' }, // the geocoder knows nothing about it
];
const GEO = {
  Santiago: [{ id: 's', name: 'Santiago', countryCode: 'CL', lat: SANTIAGO.lat, lng: SANTIAGO.lng }],
  Maipú: [{ id: 'm', name: 'Maipú', countryCode: 'CL', lat: MAIPU.lat, lng: MAIPU.lng }],
  Concepción: [{ id: 'c', name: 'Concepción', countryCode: 'CL', lat: -36.8201, lng: -73.0444 }],
};

describe('2) silent healing on the screen', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRegistry();
    resetToasts();
    saveWorkers(OLD_DIR);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });
  const job = { cityOrRegion: 'Santiago', location: null };

  it('without a geocoder (offline / off): everybody stays in Locale, flagged "Distancia desconocida"; nothing crashes', async () => {
    await mount(null, job);
    await typeInto(q('crew-search'), 'ana');
    expect(ids().sort()).toEqual(['wk000001', 'wk000002', 'wk000003']);
    expect(q('crew-pick-wk000002').querySelector('[data-testid="crew-pick-unknown"]').textContent).toBe('Distancia desconocida');
    expect(q('crew-pick-wk000001').getAttribute('data-unknown')).toBe('true');
  });
  it('a geocoder that fails (offline, API error) behaves the same way: nobody is hidden', async () => {
    const geocode = vi.fn(async () => {
      throw new Error('offline');
    });
    await mount(geocode, job);
    await typeInto(q('crew-search'), 'ana');
    await flush(1400);
    expect(geocode).toHaveBeenCalled();
    expect(ids().sort()).toEqual(['wk000001', 'wk000002', 'wk000003']);
    expect(q('crew-pick-wk000001').getAttribute('data-unknown')).toBe('true');
  });
  it('the missing points are fetched in the background and the distance is measured: the near one gets its km, the far one leaves Locale, the unknown one stays', async () => {
    const geocode = vi.fn(async (text) => GEO[text] ?? []);
    await mount(geocode, job);
    await typeInto(q('crew-search'), 'ana');
    await flush(1400); // the geocoder is asked one request at a time, a second apart
    await flush(1400);
    await flush(1400);
    const asked = geocode.mock.calls.map((c) => c[0]);
    expect(asked[0]).toBe('Santiago'); // the job first
    expect(asked).toEqual(expect.arrayContaining(['Maipú', 'Concepción', 'Villa Imaginaria']));
    expect(asked.filter((a) => a === 'Maipú')).toHaveLength(1); // once
    expect(ids()).toContain('wk000001');
    expect(note('wk000001')).toMatch(/Local · 1[01] km/); // Santiago - Maipú ~11 km
    expect(q('crew-pick-wk000001').getAttribute('data-unknown')).toBeNull();
    expect(ids()).not.toContain('wk000002'); // Concepción: 420 km, measured, out of Locale
    expect(ids()).toContain('wk000003'); // unknown, still offered
    expect(q('crew-pick-wk000003').getAttribute('data-unknown')).toBe('true');
    await click(q('crew-range-all'));
    expect(ids()).toContain('wk000002'); // "Todos" still lists him
    // nothing was saved: the healing lives in memory
    expect(projectNow.location ?? null).toBeNull();
  });
  it('a job that already has a point is not geocoded; only the workers are', async () => {
    const geocode = vi.fn(async (text) => GEO[text] ?? []);
    await mount(geocode, { cityOrRegion: 'Santiago', location: { ...SANTIAGO, label: 'Santiago' } });
    await typeInto(q('crew-search'), 'ana');
    await flush(1400);
    await flush(1400);
    await flush(1400);
    expect(geocode.mock.calls.map((c) => c[0])).not.toContain('Santiago');
    expect(note('wk000001')).toMatch(/Local · 1[01] km/);
  });
  it('nothing is asked until the user searches', async () => {
    const geocode = vi.fn(async () => []);
    await mount(geocode, job);
    await flush(1400);
    expect(geocode).not.toHaveBeenCalled();
  });
});
