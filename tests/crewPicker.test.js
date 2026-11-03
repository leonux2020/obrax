// @vitest-environment happy-dom
// Fase 4, paso 2: the hybrid selector to add personnel to a project (global directory + free text), trade chips and the 3-level reach
// ("Local < 70 km" by default, "Regional", "Todos"), nearest and best rated first.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import { newProject, normalizeProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { WORKER_SPECIALTIES, normalizeCrew } from '../src/lib/ledger.js';
import { DEFAULT_RANGE, LOCAL_KM, crewHealth, findByName, norm, projectPlaces, proximity, rankWorkers } from '../src/lib/crewMatch.js';
import { loadWorkers, saveWorkers } from '../src/lib/workers.js';
import { DICT } from '../src/lib/dict.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIRECTORY = [
  { id: 'wk000001', name: 'Ana Ruiz', specialties: ['electrician'], rating: 3, address: 'Av. Pajaritos 1234, Maipú', allergies: 'Penicilina' },
  { id: 'wk000002', name: 'Beto Soto', specialties: ['electrician', 'plumber'], rating: 5, address: 'Calle 5, Maipú' },
  { id: 'wk000003', name: 'Carla Díaz', specialties: ['plumber'], rating: 5, address: 'Providencia, Santiago, Región Metropolitana' },
  { id: 'wk000004', name: 'Dante Mora', specialties: ['electrician'], rating: 5, address: 'Av. Libertad 10, Viña del Mar' },
  { id: 'wk000005', name: 'Eva Lara', specialties: ['mason'], rating: 4, address: '' },
];
const place = { cityOrRegion: 'Maipú, Región Metropolitana' };

describe('crewMatch: the emulated distance and the ranking', () => {
  it('defaults: local, 70 km', () => {
    expect(DEFAULT_RANGE).toBe('local');
    expect(LOCAL_KM).toBe(70);
  });
  it('projectPlaces: the first part is the city, the rest the region; accents / case / generic words are ignored', () => {
    expect(projectPlaces(place)).toEqual({ city: 'maipu', others: ['region metropolitana'] });
    expect(projectPlaces({ cityOrRegion: 'Valparaíso' })).toEqual({ city: 'valparaiso', others: [] });
    expect(projectPlaces({ cityOrRegion: '' })).toEqual({ city: '', others: [] });
    expect(projectPlaces({ cityOrRegion: 'Región, Maipú' }).city).toBe('maipu');
    expect(norm('  MAIPÚ!! ')).toBe('maipu');
  });
  it('proximity: 0 names the city, 1 names the region, 2 elsewhere, 3 cannot tell', () => {
    const by = (id) => DIRECTORY.find((w) => w.id === id);
    expect([1, 2, 3, 4, 5].map((n) => proximity(place, by(`wk00000${n}`)))).toEqual([0, 0, 1, 2, 3]);
    expect(proximity({ cityOrRegion: '' }, by('wk000001'))).toBe(3); // the job has no place
    expect(proximity(place, { address: 'Maipúcito 5, Chile' })).toBe(2); // whole words only
  });
  it('ranking: nearest first, then best rated, then name', () => {
    const r = (range, extra = {}) => rankWorkers(DIRECTORY, { project: place, range, ...extra }).rows.map((x) => x.worker.name);
    expect(r('local')).toEqual(['Beto Soto', 'Ana Ruiz']); // both local: 5 stars before 3
    expect(r('regional')).toEqual(['Beto Soto', 'Ana Ruiz', 'Carla Díaz']);
    expect(r('all')).toEqual(['Beto Soto', 'Ana Ruiz', 'Carla Díaz', 'Dante Mora', 'Eva Lara']);
    expect(rankWorkers(DIRECTORY, { project: place }).rows).toHaveLength(2); // default = local
  });
  it('filters: trade, typed text (accents ignored), and the count hidden for lack of address', () => {
    const names = (o) => rankWorkers(DIRECTORY, { project: place, range: 'all', ...o }).rows.map((x) => x.worker.name);
    expect(names({ specialty: 'electrician' })).toEqual(['Beto Soto', 'Ana Ruiz', 'Dante Mora']);
    expect(names({ specialty: 'plumber', range: 'local' })).toEqual(['Beto Soto']);
    expect(names({ query: 'DIAZ' })).toEqual(['Carla Díaz']);
    expect(names({ query: 'ana ru' })).toEqual(['Ana Ruiz']); // every typed word is looked for in the name
    expect(rankWorkers(DIRECTORY, { project: place, range: 'local' }).hidden).toBe(1); // Eva has no address
    expect(rankWorkers(DIRECTORY, { project: place, range: 'all' }).hidden).toBe(0);
  });
  it('a job with no place cannot be filtered by reach: everybody is offered (and `placed` says so)', () => {
    const res = rankWorkers(DIRECTORY, { project: { cityOrRegion: '' }, range: 'local' });
    expect(res.placed).toBe(false);
    expect(res.rows).toHaveLength(5);
  });
  it('findByName: exact, accents / case ignored', () => {
    expect(findByName(DIRECTORY, 'beto  SOTO')?.id).toBe('wk000002');
    expect(findByName(DIRECTORY, 'Beto')).toBeNull();
    expect(findByName(DIRECTORY, '')).toBeNull();
  });
  it('a crew member keeps the link to the directory file (`ref`) through normalization; a bad ref is dropped', () => {
    expect(normalizeCrew([{ name: 'Ana', ref: 'wk000001' }])[0].ref).toBe('wk000001');
    expect(normalizeCrew([{ name: 'Ana', ref: '<x>' }])[0]).not.toHaveProperty('ref');
    expect(normalizeCrew([{ name: 'Ana' }])[0]).not.toHaveProperty('ref'); // plain-text people have none
  });
  it('every language names the three reaches and the 70 km one carries the number', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      for (const k of ['crew.range.local', 'crew.range.regional', 'crew.range.all', 'crew.pick.name', 'crew.pick.add']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
      expect(DICT[l]['crew.range.local']).toContain('{km}');
    }
  });
});

// ---- the screen ---------------------------------------------------------------------------------------------------------------
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
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
function Harness({ initial }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} });
}
const mount = async (extra = place) => {
  spy = {};
  const project = { ...newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana' }), crew: [], ...extra };
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: project })));
  });
  await flush();
  await click(q('ws-crew'));
  await click(q('crew-add'));
};
const listed = () => qa('crew-pick-name').map((n) => n.textContent);

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

describe('CrewPicker: the hybrid selector', () => {
  it('replaces the plain input: the directory is listed below the name field; rows show name, stars and the ⚠ only for health notes', async () => {
    await mount();
    expect(q('worker-form')).not.toBeNull();
    expect(q('crew-name')).not.toBeNull();
    expect(q('crew-directory')).not.toBeNull();
    const ana = q('crew-pick-wk000001');
    expect(ana.querySelector('[data-testid="stars"]').dataset.rating).toBe('3');
    expect(ana.querySelector('[data-testid="crew-pick-health"]')).not.toBeNull();
    expect(q('crew-pick-wk000002').querySelector('[data-testid="crew-pick-health"]')).toBeNull();
    for (const c of ana.querySelectorAll('[data-testid="crew-pick-chip"]')) for (const cls of ['text-xs', 'bg-neutral-800', 'text-neutral-300']) expect(c.className).toContain(cls);
  });

  it('REACH: three chips, "Local (< 70 km)" active by default; the list is local, nearest and best rated first', async () => {
    await mount();
    const chips = [...q('crew-range').querySelectorAll('button')];
    expect(chips.map((c) => c.dataset.testid)).toEqual(['crew-range-local', 'crew-range-regional', 'crew-range-all']);
    expect(chips.map((c) => c.textContent)).toEqual(['Local (< 70 km)', 'Regional', 'Todos']);
    expect(chips.map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    for (const c of chips) expect(c.className).toContain('text-xs'); // quiet
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz']);
    expect(q('crew-hidden').textContent).toBe('1 sin dirección: solo aparecen en «Todos».');
  });

  it('widening the reach is one tap: Regional adds the region, Todos the whole directory (order still nearest first)', async () => {
    await mount();
    await click(q('crew-range-regional'));
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz', 'Carla Díaz']);
    expect(q('crew-range-regional').getAttribute('aria-checked')).toBe('true');
    expect(q('crew-range-local').getAttribute('aria-checked')).toBe('false');
    expect(q('crew-pick-wk000003').querySelector('[data-testid="crew-pick-note"]').textContent).toBe('Regional');
    expect(q('crew-pick-wk000002').querySelector('[data-testid="crew-pick-note"]').textContent).toBe('Local');
    await click(q('crew-range-all'));
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz', 'Carla Díaz', 'Dante Mora', 'Eva Lara']);
    expect(q('crew-hidden')).toBeNull();
    await click(q('crew-range-local')); // and back
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz']);
  });

  it('TRADE CHIPS: a horizontally scrolling row with every trade; one tap filters at once, a second one clears', async () => {
    await mount();
    const row = q('crew-filters');
    expect(row.className).toContain('overflow-x-auto');
    expect(qa('crew-filters')[0].querySelectorAll('button')).toHaveLength(WORKER_SPECIALTIES.length);
    await click(q('crew-range-all'));
    await click(q('crew-filter-electrician'));
    expect(q('crew-filter-electrician').getAttribute('aria-pressed')).toBe('true');
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz', 'Dante Mora']);
    await click(q('crew-filter-plumber'));
    expect(listed()).toEqual(['Beto Soto', 'Carla Díaz']);
    expect(q('crew-filter-electrician').getAttribute('aria-pressed')).toBe('false'); // one trade at a time
    await click(q('crew-filter-plumber'));
    expect(listed()).toHaveLength(5);
  });

  it('typing filters the directory by name as you write (and only that: nothing is added until you say so)', async () => {
    await mount();
    await click(q('crew-range-all'));
    await typeInto(q('crew-name'), 'bet');
    expect(listed()).toEqual(['Beto Soto']);
    expect(spy.project.crew).toHaveLength(0);
  });

  it('FLOW 1: tapping a worker of the directory adds him / her at once, linked to the file, with the first trade; the sheet closes', async () => {
    await mount();
    await click(q('crew-pick-wk000002'));
    expect(q('worker-form')).toBeNull();
    expect(spy.project.crew).toHaveLength(1);
    expect(spy.project.crew[0]).toMatchObject({ name: 'Beto Soto', specialty: 'electrician', ref: 'wk000002' });
    expect(q(`worker-${spy.project.crew[0].id}`)).not.toBeNull(); // the card of the project
    await click(q('crew-add'));
    const row = q('crew-pick-wk000002'); // already in: shown, locked, not addable twice
    expect(row.disabled).toBe(true);
    expect(row.querySelector('[data-testid="crew-pick-note"]').textContent).toBe('En el proyecto');
    await click(row);
    expect(spy.project.crew).toHaveLength(1);
  });

  it('with a trade chip on, the person is added with THAT trade (the one they were looked up for)', async () => {
    await mount();
    await click(q('crew-filter-plumber'));
    await click(q('crew-range-all'));
    await click(q('crew-pick-wk000002')); // Beto: electrician + plumber
    expect(spy.project.crew[0]).toMatchObject({ name: 'Beto Soto', specialty: 'plumber', ref: 'wk000002' });
  });

  it('FLOW 2 (urgency): a name that is not in the directory goes in as PLAIN TEXT in one tap: no file, no medical form, the directory untouched', async () => {
    await mount();
    await typeInto(q('crew-name'), 'Pedro Urgente');
    expect(listed()).toEqual([]);
    expect(q('crew-pick-hint').textContent).toBe('Nadie coincide: se añadirá como texto simple.');
    expect(q('crew-save').textContent).toBe('Añadir «Pedro Urgente»');
    await click(q('crew-save'));
    expect(q('worker-form')).toBeNull();
    expect(spy.project.crew).toHaveLength(1);
    expect(spy.project.crew[0]).toMatchObject({ name: 'Pedro Urgente', specialty: 'multi' });
    expect(spy.project.crew[0]).not.toHaveProperty('ref');
    expect(loadWorkers()).toHaveLength(5); // nothing created in the global directory
    expect(host.querySelector('[data-testid="worker-block-safety"]')).toBeNull();
  });

  it('Enter in the field adds the typed name too, with the active trade chip as its specialty', async () => {
    await mount();
    await click(q('crew-filter-mason'));
    await typeInto(q('crew-name'), 'Luis Albañil');
    await act(async () => {
      q('worker-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(spy.project.crew[0]).toMatchObject({ name: 'Luis Albañil', specialty: 'mason' });
  });

  it('typing the exact name of someone in the directory links his file instead of creating a lookalike', async () => {
    await mount();
    await typeInto(q('crew-name'), 'carla diaz');
    await click(q('crew-save'));
    expect(spy.project.crew[0]).toMatchObject({ name: 'Carla Díaz', ref: 'wk000003', specialty: 'plumber' });
  });

  it('the add button needs text (disabled while empty), as before', async () => {
    await mount();
    expect(q('crew-save').disabled).toBe(true);
    await typeInto(q('crew-name'), 'X');
    expect(q('crew-save').disabled).toBe(false);
  });

  it('a job with no city cannot filter by reach: says so and offers everybody', async () => {
    await mount({ cityOrRegion: '' });
    expect(q('crew-noplace').textContent).toContain('Indica la ciudad de la obra');
    expect(listed()).toHaveLength(5);
  });

  it('an empty range explains how to widen it; an empty directory still lets you type a name', async () => {
    await mount({ cityOrRegion: 'Punta Arenas' });
    expect(listed()).toEqual([]);
    expect(q('crew-pick-hint').textContent).toBe('Nadie en este alcance: amplía el radio.');
    await click(q('crew-range-all'));
    expect(listed()).toHaveLength(5);
    act(() => root.unmount());
    root = createRoot(host);
    localStorage.clear();
    await mount();
    expect(q('crew-pick-hint').textContent).toContain('El directorio está vacío');
    await typeInto(q('crew-name'), 'Solo Texto');
    await click(q('crew-save'));
    expect(spy.project.crew[0].name).toBe('Solo Texto');
  });

  it('the person of the project is still edited with the old sheet (name, trade, notes) and keeps the directory link', async () => {
    await mount();
    await click(q('crew-pick-wk000001'));
    const id = spy.project.crew[0].id;
    await click(q(`worker-edit-${id}`));
    expect(q('crew-specialty')).not.toBeNull();
    await typeInto(q('crew-notes'), 'Tablero');
    await click(q('crew-save'));
    expect(spy.project.crew[0]).toMatchObject({ id, ref: 'wk000001', notes: 'Tablero' });
  });
});

describe('safety: the ⚠ of the file follows the worker onto the job', () => {
  const card = (id) => q(`worker-health-${id}`);
  const idOf = (name) => spy.project.crew.find((w) => w.name === name).id;

  it('a worker picked from the directory with health notes carries the ⚠ on his / her card (orange, always visible); one without notes does not', async () => {
    await mount();
    await click(q('crew-pick-wk000001')); // Ana: allergy
    await click(q('crew-add'));
    await click(q('crew-pick-wk000002')); // Beto: nothing to warn about
    const ana = idOf('Ana Ruiz');
    const beto = idOf('Beto Soto');
    expect(spy.project.crew.find((w) => w.id === ana)).toMatchObject({ ref: 'wk000001', health: true });
    expect(spy.project.crew.find((w) => w.id === beto)).not.toHaveProperty('health');
    const flag = card(ana);
    expect(flag).not.toBeNull();
    expect(flag.textContent).toBe('⚠');
    expect(flag.className).toContain('text-orange-500');
    expect(flag.getAttribute('aria-label')).toBe('Tiene datos de salud');
    expect(q(`worker-${ana}`).contains(flag)).toBe(true); // on the card itself, not behind a tap
    expect(card(beto)).toBeNull();
    expect(q(`worker-edit-${ana}`).getAttribute('aria-label')).toContain('⚠'); // announced with the name by a screen reader
    expect(q(`worker-edit-${beto}`).getAttribute('aria-label')).not.toContain('⚠');
  });

  it('a limiting condition alone is enough to raise it', async () => {
    saveWorkers([{ id: 'wk000009', name: 'Fito Vega', specialties: ['mason'], rating: 2, address: 'Maipú', limiting: 'Vértigo: no trabajar en altura' }]);
    await mount();
    await click(q('crew-pick-wk000009'));
    expect(card(spy.project.crew[0].id)).not.toBeNull();
  });

  it('typed as plain text there is no file and no ⚠ (nothing is invented)', async () => {
    await mount();
    await typeInto(q('crew-name'), 'Pedro Urgente');
    await click(q('crew-save'));
    expect(card(spy.project.crew[0].id)).toBeNull();
  });

  it('the file is read LIVE: someone already on the job (added before this fix, no snapshot) shows it too, and clearing the notes of the file clears it', async () => {
    await mount({ ...place, crew: normalizeCrew([{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001' }]) });
    expect(card('crew0001')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    saveWorkers(DIRECTORY.map((w) => (w.id === 'wk000001' ? { ...w, allergies: '' } : w))); // the notes were cleared in the file
    await mount({ ...place, crew: normalizeCrew([{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001', health: true }]) });
    expect(card('crew0001')).toBeNull();
  });

  it('a deleted file NEVER silences the warning recorded when the person was added', async () => {
    await mount({ ...place, crew: normalizeCrew([{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001', health: true }]) });
    act(() => root.unmount());
    root = createRoot(host);
    saveWorkers(DIRECTORY.filter((w) => w.id !== 'wk000001'));
    await mount({ ...place, crew: normalizeCrew([{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001', health: true }]) });
    expect(card('crew0001')).not.toBeNull();
  });

  it('it survives editing the person on the job, saving the project and loading it again, and the advance flow does not hide it', async () => {
    await mount();
    await click(q('crew-pick-wk000001'));
    const id = spy.project.crew[0].id;
    await click(q(`worker-edit-${id}`));
    await typeInto(q('crew-notes'), 'Tablero');
    await click(q('crew-save'));
    expect(spy.project.crew[0]).toMatchObject({ ref: 'wk000001', health: true, notes: 'Tablero' });
    expect(card(id)).not.toBeNull();
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(spy.project)));
    expect(reloaded.crew[0]).toMatchObject({ ref: 'wk000001', health: true });
    expect(q(`worker-${id}`).contains(card(id))).toBe(true);
    expect(q(`worker-adv-${id}`)).not.toBeNull(); // the card keeps its own actions next to the warning
  });

  it('crewHealth: live file wins; a deleted file falls back to the snapshot; no ref, no warning', () => {
    const ana = { ref: 'wk000001' };
    expect(crewHealth(ana, DIRECTORY)).toBe(true);
    expect(crewHealth({ ref: 'wk000002' }, DIRECTORY)).toBe(false);
    expect(crewHealth({ ref: 'wk000002', health: true }, DIRECTORY)).toBe(false); // the file says there is nothing now
    expect(crewHealth({ ref: 'wk000001', health: true }, [])).toBe(true); // file gone
    expect(crewHealth({ ref: 'wk000001' }, [])).toBe(false);
    expect(crewHealth({ name: 'texto', health: true }, DIRECTORY)).toBe(false);
    expect(crewHealth(null, DIRECTORY)).toBe(false);
  });

  it('`health` only lives on people linked to a file (a stray flag with no ref is dropped); invalid values too', () => {
    expect(normalizeCrew([{ name: 'A', health: true }])[0]).not.toHaveProperty('health');
    expect(normalizeCrew([{ name: 'A', ref: 'wk000001', health: 'yes' }])[0]).not.toHaveProperty('health');
    expect(normalizeCrew([{ name: 'A', ref: 'wk000001', health: true }])[0]).toMatchObject({ ref: 'wk000001', health: true });
  });
});
