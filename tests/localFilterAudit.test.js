// @vitest-environment happy-dom
// Silent failure: a worker 20 km from the job showed up under "Todos" but vanished under "Locale (< 70 km)". Strict self-audit:
//   a) types: lat / lon as strings, null, undefined, '' or garbage must never crash nor turn into 0
//   b) the `<= 70` test runs on NUMBERS (every coordinate is cast with parseFloat before the formula)
//   c) the coordinates survive every save (project sheet, worker file, storage, backup merge)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import WorkerSheet from '../src/components/squadra/WorkerSheet.jsx';
import { LOCAL_KM, distanceKm, proximity, rankWorkers } from '../src/lib/crewMatch.js';
import { haversineKm, normalizeCoords, toCoord } from '../src/lib/geoDistance.js';
import { normalizeLocation } from '../src/lib/ledger.js';
import { normalizeProject, newProject } from '../src/lib/projects.js';
import { loadWorkers, mergeWorkers, normalizeWorker, upsertWorker } from '../src/lib/workers.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

// Santiago de Chile (the job) and a point ~20 km away (Maipú-ish): 0.18 degrees of latitude = ~20 km
const JOB = { lat: -33.4489, lng: -70.6693 };
const NEAR = { lat: -33.4489 - 0.18, lon: -70.6693 };
const rows = (workers, project, range) => rankWorkers(workers, { project, range }).rows.map((r) => r.worker.name);

describe('a) the worker at 20 km is in "Locale" whatever the shape of the coordinates', () => {
  const wk = (extra) => ({ id: 'wk000001', name: 'Vecino', specialties: ['mason'], rating: 4, ...extra });

  it('the fixture really is ~20 km away', () => {
    const km = haversineKm(JOB, { lat: NEAR.lat, lng: NEAR.lon });
    expect(km).toBeGreaterThan(18);
    expect(km).toBeLessThan(22);
  });
  it('numbers: Locale and Todos both list him', () => {
    const project = { cityOrRegion: 'Santiago', location: { ...JOB, label: 'Santiago' } };
    expect(rows([wk(NEAR)], project, 'local')).toEqual(['Vecino']);
    expect(rows([wk(NEAR)], project, 'all')).toEqual(['Vecino']);
  });
  it('STRINGS on both sides (what Nominatim sends): cast with parseFloat, same answer, and the distance is a NUMBER', () => {
    const project = { cityOrRegion: 'Santiago', location: { lat: '-33.4489', lng: '-70.6693', label: 'Santiago' } };
    const worker = wk({ lat: '-33.6289', lon: '-70.6693' });
    const km = distanceKm(project, worker);
    expect(typeof km).toBe('number');
    expect(km).toBeGreaterThan(18);
    expect(km).toBeLessThan(22);
    expect(proximity(project, worker)).toBe(0);
    expect(rows([worker], project, 'local')).toEqual(['Vecino']);
    // the raw (not yet normalized) worker works too
    expect(distanceKm(project, { lat: '-33.6289', lng: '-70.6693' })).toBeCloseTo(km, 6);
  });
  it('the project may spell the point lat / lon and a worker lat / lng; decimal commas are understood', () => {
    expect(distanceKm({ location: { lat: -33.4489, lon: -70.6693 } }, { lat: -33.6289, lng: -70.6693 })).toBeGreaterThan(18);
    expect(distanceKm({ location: { lat: '-33,4489', lng: '-70,6693' } }, { lat: '-33,6289', lon: '-70,6693' })).toBeLessThan(22);
  });
  it('b) the comparison is numeric: a distance of 9 km is local although "9" > "70" as text', () => {
    const near9 = { id: 'wk000002', name: 'Muy cerca', lat: '-33.4489', lon: '-70.7503' }; // ~7.5 km
    const project = { location: { lat: '-33.4489', lng: '-70.6693' } };
    const km = distanceKm(project, near9);
    expect(String(Math.round(km)) > String(LOCAL_KM)).toBe(true); // the trap: as TEXT it would be "far"
    expect(proximity(project, near9)).toBe(0); // as a number it is local
  });
  it('the boundary is inclusive: exactly 70 km is local, just over is regional', () => {
    const at = (km) => ({ lat: JOB.lat - km / 111.195, lon: JOB.lng }); // 1 degree of latitude ~ 111.195 km
    const project = { location: JOB };
    expect(proximity(project, at(69.5))).toBe(0);
    expect(proximity(project, at(71))).toBe(1);
  });
});

describe('a) null / undefined / "" / garbage never crash and never become 0', () => {
  const project = { cityOrRegion: 'Santiago', location: { lat: -33.4489, lng: -70.6693, label: 'Santiago' } };
  const nothing = [null, undefined, '', ' ', 'abc', NaN, {}, [], true, false];

  it('toCoord: only believable numbers survive; the empty ones are NaN, not 0', () => {
    expect(toCoord('-33.45')).toBe(-33.45);
    expect(toCoord(' 12,5 ')).toBe(12.5);
    expect(toCoord(7)).toBe(7);
    for (const v of nothing) expect(Number.isFinite(toCoord(v)), String(v)).toBe(false);
  });
  it('normalizeLocation / normalizeCoords: strings are cast, empty values give null (Number("") would have made 0,0)', () => {
    expect(normalizeLocation({ lat: '-33.45', lng: '-70.66', label: 'Santiago' })).toEqual({ lat: -33.45, lng: -70.66, label: 'Santiago' });
    expect(normalizeLocation({ lat: -33.45, lon: '-70.66' })).toMatchObject({ lng: -70.66 });
    for (const v of nothing) {
      expect(normalizeLocation({ lat: v, lng: v })).toBeNull();
      expect(normalizeCoords({ lat: v, lng: v })).toBeNull();
    }
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation({ lat: 200, lng: 5 })).toBeNull();
  });
  it('a worker with empty / garbage coordinates keeps no point, is not measured and still shows in Locale by the name of his city', () => {
    for (const v of nothing) {
      const worker = { id: 'wk000003', name: 'Sin punto', city: 'Santiago', lat: v, lon: v };
      expect(() => distanceKm(project, worker)).not.toThrow();
      expect(distanceKm(project, worker)).toBeNull();
      expect(normalizeWorker(worker)).not.toHaveProperty('lat');
      expect(rows([worker], project, 'local'), String(v)).toEqual(['Sin punto']);
    }
  });
  it('a project with empty / garbage coordinates falls back to the city name for everybody', () => {
    const worker = { id: 'wk000004', name: 'Vecino', city: 'Santiago', lat: NEAR.lat, lon: NEAR.lon };
    for (const v of nothing) {
      const job = { cityOrRegion: 'Santiago', location: { lat: v, lng: v } };
      expect(() => rankWorkers([worker], { project: job, range: 'local' })).not.toThrow();
      expect(rows([worker], job, 'local'), String(v)).toEqual(['Vecino']);
    }
    expect(rows([worker], { cityOrRegion: 'Santiago' }, 'local')).toEqual(['Vecino']);
    expect(rows([worker], null, 'local')).toEqual(['Vecino']);
  });
  it('NaN from the formula (unusable point): one internal warning, the worker is NOT dropped when his city matches the job exactly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const badJob = { cityOrRegion: 'Santiago', location: { lat: 999, lng: -70.6693, label: 'Santiago' } }; // out of range: Haversine cannot answer
      const worker = { id: 'wk000005', name: 'Mismo pueblo', city: 'Santiago', lat: NEAR.lat, lon: NEAR.lon };
      expect(distanceKm(badJob, worker)).toBeNull();
      expect(proximity(badJob, worker)).toBe(0); // legacy fallback: exact city name
      expect(rows([worker], badJob, 'local')).toEqual(['Mismo pueblo']);
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0][0])).toContain('crewMatch');
      const calls = warn.mock.calls.length;
      rows([worker], badJob, 'local');
      expect(warn.mock.calls.length).toBe(calls); // once per worker, no flood
      // a different city cannot be measured either: it is kept too, but flagged "unknown" (inclusive)
      const other = rankWorkers([{ ...worker, id: 'wk000006', city: 'Rancagua' }], { project: badJob, range: 'local' }).rows;
      expect(other).toHaveLength(1);
      expect(other[0].unknown).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('c) the coordinates are never dropped on the way to storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('worker: string coordinates are stored as numbers and read back through upsert -> load', () => {
    upsertWorker({ id: 'wk000010', name: 'Beto', city: 'Maipú', lat: '-33.6289', lon: '-70.6693' });
    const w = loadWorkers().find((x) => x.id === 'wk000010');
    expect(w).toMatchObject({ lat: -33.6289, lon: -70.6693 });
    expect(typeof w.lat).toBe('number');
    expect(JSON.parse(localStorage.getItem('cp.workers.v1'))[0]).toMatchObject({ lat: -33.6289, lon: -70.6693 });
  });
  it('worker: a re-save without touching the point keeps it; the Drive merge keeps the point of the newest copy', () => {
    upsertWorker({ id: 'wk000011', name: 'Beto', lat: -33.6, lon: -70.6 });
    upsertWorker({ ...loadWorkers()[0], phone: '123' });
    expect(loadWorkers()[0]).toMatchObject({ lat: -33.6, lon: -70.6, phone: '123' });
    const merged = mergeWorkers([{ id: 'wk000011', name: 'Beto', updatedAt: 1 }], [{ id: 'wk000011', name: 'Beto', lat: '-33.7', lon: '-70.7', updatedAt: 2 }]);
    expect(merged[0]).toMatchObject({ lat: -33.7, lon: -70.7 });
  });
  it('project: the located point survives normalizeProject (strings included)', () => {
    const p = newProject({ regionCode: 'CL', name: 'Casa', location: { lat: '-33.4489', lng: '-70.6693', label: 'Santiago' }, cityOrRegion: 'Santiago' });
    expect(p.location).toEqual({ lat: -33.4489, lng: -70.6693, label: 'Santiago' });
    const back = normalizeProject(JSON.parse(JSON.stringify({ ...p, location: { lat: '-33.4489', lng: '-70.6693', label: 'Santiago' } })));
    expect(back.location).toEqual({ lat: -33.4489, lng: -70.6693, label: 'Santiago' });
  });

  describe('forms', () => {
    let host;
    let root;
    beforeEach(() => {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
    });
    afterEach(async () => {
      await act(async () => root.unmount());
      host.remove();
    });
    // places exactly as a hostile / old search function could return them: coordinates as STRINGS
    const STRING_PLACES = [{ id: 'p1', name: 'Maipú', label: 'Maipú, Chile', country: 'Chile', countryCode: 'CL', lat: '-33.6289', lng: '-70.6693' }];

    it('worker file: picking the town with string coordinates saves NUMBERS and the form says it is located', async () => {
      let saved = null;
      await act(async () => {
        root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(WorkerSheet, { worker: null, onSave: (w) => (saved = w), onClose: () => {}, search: async () => STRING_PLACES, searchDelay: 0 })));
      });
      await typeInto(q('worker-name'), 'Beto');
      await typeInto(q('worker-city'), 'Maip');
      await flush(5);
      await act(async () => q('worker-city-option-0').click());
      expect(q('worker-city-box').getAttribute('data-located')).toBe('true');
      await act(async () => q('worker-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(saved).toMatchObject({ city: 'Maipú', lat: -33.6289, lon: -70.6693 });
      expect(typeof saved.lat).toBe('number');
      // and what the directory stores is measurable against the job: ~20 km, Locale
      const { worker } = upsertWorker(saved);
      expect(rows([worker], { location: { ...JOB, label: 'Santiago' } }, 'local')).toEqual(['Beto']);
    });
    it('project sheet: picking the city with string coordinates sends a NUMERIC location to the save payload', async () => {
      const saved = [];
      await act(async () => {
        root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(ProjectSheet, { onSave: (p) => saved.push(p), onClose: () => {}, search: async () => STRING_PLACES, searchDelay: 0 })));
      });
      await typeInto(q('project-city'), 'Maip');
      await flush(5);
      await act(async () => q('project-city-option-0').click());
      await act(async () => q('new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(saved).toHaveLength(1);
      expect(saved[0].location).toEqual({ lat: -33.6289, lng: -70.6693, label: 'Maipú' });
      expect(typeof saved[0].location.lat).toBe('number');
    });
  });
});
