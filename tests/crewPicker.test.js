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
    const label = (id) => ({ electrician: 'Electricista', plumber: 'Fontanero', mason: 'Albañil' })[id] ?? id;
    expect(names({ query: 'ELECTRI', label })).toEqual(['Beto Soto', 'Ana Ruiz', 'Dante Mora']); // ...or in the label of one of their trades
    expect(names({ query: 'electri' })).toEqual([]); // without labels only the name counts
    expect(names({ query: 'ana electri', label })).toEqual(['Ana Ruiz']); // name + trade together
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
/** Crew agenda: unfolds the accordion row of a worker (when folded) so its "+ Anticipo" / "Editar" actions exist. */
const unfold = async (id) => {
  if (!q(`worker-adv-${id}`)) await click(q(`worker-toggle-${id}`));
};
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
};
/** The master search adds from the directory: widen the reach, type the person's name, tap the suggestion. */
const pick = async (id) => {
  if (q('crew-range-all')?.getAttribute('aria-checked') !== 'true') await click(q('crew-range-all'));
  await typeInto(q('crew-search'), loadWorkers().find((w) => w.id === id).name);
  await click(q(`crew-pick-${id}`));
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

describe('crew master search: ONE bar to find and add people (no modal, no boxes on boxes)', () => {
  const type = (text) => typeInto(q('crew-search'), text);
  const trade = async (id) => click(q(`crew-filter-${id}`));
  const reach = async (r) => click(q(`crew-range-${r}`));

  it('there is NO add dialog: the [+] and the dropdown are gone, the master search sits under the labour line, then ONE line of chips, then the crew', async () => {
    await mount();
    expect(q('crew-add')).toBeNull();
    expect(q('crew-selector')).toBeNull();
    expect(qa('sheet-backdrop')).toHaveLength(1); // only the crew sheet itself
    expect(q('crew-search').placeholder).toBe(DICT.es['ws.crew.search']);
    expect(q('ws-crew-sheet').contains(q('crew-search'))).toBe(true); // already there with an empty crew: it is how people are added
    expect(q('crew-suggest')).toBeNull(); // nothing is suggested until you type or pick a trade
    expect(q('crew-bar').compareDocumentPosition(q('crew-master')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('crew-master').contains(q('crew-search'))).toBe(true);
    expect(q('crew-master').contains(q('crew-filters'))).toBe(true);
    expect(q('crew-search').compareDocumentPosition(q('crew-filters')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await pick('wk000002');
    expect(q('crew-master').compareDocumentPosition(q('crew-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('crew-master').className).toContain('sticky'); // anchored while the crew scrolls
  });

  it('the distance capsules sit in the SAME line as the trade chips and look exactly like them (matte bg-white/5, quiet text, active bg-white/10)', async () => {
    await mount();
    const strip = q('crew-filters');
    for (const cls of ['overflow-x-auto', 'hide-scrollbar', 'flex']) expect(strip.className).toContain(cls);
    expect(q('crew-range')).not.toBeNull();
    expect(strip.contains(q('crew-range'))).toBe(true);
    const chips = [...strip.querySelectorAll('button')].map((b) => b.dataset.testid);
    expect(chips).toEqual(['crew-range-local', 'crew-range-regional', 'crew-range-all', ...WORKER_SPECIALTIES.map((s) => `crew-filter-${s}`)]); // ONE row: distance first, then trades
    expect([...q('crew-range').querySelectorAll('button')].map((c) => c.textContent)).toEqual(['Local (< 70 km)', 'Regional', 'Todos']);
    expect([...q('crew-range').querySelectorAll('button')].map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']); // local by default
    for (const c of strip.querySelectorAll('button')) {
      expect(c.className).toContain('rounded-full');
      expect(c.className).toContain('text-xs');
      expect(c.className).not.toMatch(/\bborder\b|\bw-full\b|min-h-\[44px\]|grid/); // not the old giant buttons
    }
    expect(q('crew-range-regional').className).toBe(q('crew-filter-plumber').className); // identical look when idle
    expect(q('crew-range-regional').className).toContain('bg-white/5');
    expect(q('crew-range-regional').className).toContain('text-neutral-400');
    expect(q('crew-range-local').className).toContain('bg-white/10'); // the active one
    expect(q('crew-range-local').className).toBe(q('crew-filter-plumber').className.replace('bg-white/5 text-neutral-400', 'bg-white/10 text-neutral-100'));
    await trade('plumber');
    expect(q('crew-filter-plumber').className).toBe(q('crew-range-local').className); // active trade = active distance
    expect(q('crew-filter-plumber').getAttribute('aria-pressed')).toBe('true');
    await trade('plumber');
    expect(q('crew-filter-plumber').getAttribute('aria-pressed')).toBe('false'); // a second tap clears
  });

  it('typing a NAME suggests the company directory in real time: tap a suggestion and the person joins the job at once, linked to the file', async () => {
    await mount();
    await type('bet');
    expect(q('crew-suggest')).not.toBeNull();
    expect(listed()).toEqual(['Beto Soto']);
    expect(spy.project.crew).toHaveLength(0); // nothing is added until you tap
    await click(q('crew-pick-wk000002'));
    expect(spy.project.crew).toHaveLength(1);
    expect(spy.project.crew[0]).toMatchObject({ name: 'Beto Soto', specialty: 'electrician', ref: 'wk000002' });
    expect(q('crew-search').value).toBe(''); // the bar is clean again
    expect(q('crew-suggest')).toBeNull();
    expect(q(`worker-${spy.project.crew[0].id}`)).not.toBeNull();
    expect(qa('sheet-backdrop')).toHaveLength(1); // no sheet opened on the way
  });

  it('typing a TRADE ("electri") suggests the people of that trade (nearest first); accents and case do not matter', async () => {
    await mount();
    await type('ELÉCTRI');
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz']); // local by default
    await reach('all');
    expect(listed()).toEqual(['Beto Soto', 'Ana Ruiz', 'Dante Mora']);
    await type('albanil');
    expect(listed()).toEqual(['Eva Lara']);
  });

  it('the suggestions are quiet contact rows: avatar, name, trade · distance, stars, the ⚠ only for health notes; no boxes', async () => {
    await mount();
    await type('ruiz');
    const ana = q('crew-pick-wk000001');
    expect(ana.querySelector('[data-testid="stars"]').dataset.rating).toBe('3');
    expect(ana.querySelector('[data-testid="crew-pick-health"]')).not.toBeNull();
    expect(ana.querySelector('[data-testid="crew-pick-note"]').textContent).toBe('Electricista · Local');
    expect(ana.closest('li').className).toContain('border-b border-white/5');
    expect(ana.className).not.toMatch(/\bborder\b|rounded-xl/);
    await type('beto');
    expect(q('crew-pick-wk000002').querySelector('[data-testid="crew-pick-health"]')).toBeNull();
  });

  it('REACH: Local (< 70 km) is the default; Regional adds the region, Todos the whole directory; the count without address is told quietly', async () => {
    await mount();
    await trade('plumber');
    expect(listed()).toEqual(['Beto Soto']);
    await reach('regional');
    expect(listed()).toEqual(['Beto Soto', 'Carla Díaz']);
    expect(q('crew-range-regional').getAttribute('aria-checked')).toBe('true');
    expect(q('crew-range-local').getAttribute('aria-checked')).toBe('false');
    expect(q('crew-pick-wk000003').querySelector('[data-testid="crew-pick-note"]').textContent).toBe('Plomero · Regional');
    await trade('plumber');
    await trade('mason');
    expect(listed()).toEqual([]);
    await reach('local');
    expect(q('crew-pick-hint').textContent).toBe('Nadie en este alcance: amplía el radio.');
    expect(q('crew-hidden').textContent).toBe('1 sin dirección: solo aparecen en «Todos».');
    await reach('all');
    expect(listed()).toEqual(['Eva Lara']);
    expect(q('crew-hidden')).toBeNull();
  });

  it('the trade chip filters BOTH the crew on the job and the suggestions', async () => {
    await mount();
    await pick('wk000002'); // Beto, electrician
    await pick('wk000003'); // Carla, plumber
    expect(qa('crew-list')[0].children).toHaveLength(2);
    await trade('plumber');
    expect(qa('crew-list')[0].children).toHaveLength(1);
    expect(q('crew-list').textContent).toContain('Carla Díaz');
    expect(listed()).toEqual([]); // Beto and Carla are on the job already: not suggested again
    await trade('plumber');
    expect(qa('crew-list')[0].children).toHaveLength(2);
  });

  it('whoever is already on the job is not suggested again', async () => {
    await mount();
    await pick('wk000002');
    await type('beto');
    expect(listed()).toEqual([]);
    expect(q('crew-pick-hint').textContent).toBe('Nadie coincide: se añadirá como texto simple.');
    expect(spy.project.crew).toHaveLength(1);
  });

  it('with a trade chip on, the person is added with THAT trade (the one they were looked up for)', async () => {
    await mount();
    await trade('plumber');
    await click(q('crew-pick-wk000002')); // Beto: electrician + plumber, local
    expect(spy.project.crew[0]).toMatchObject({ name: 'Beto Soto', specialty: 'plumber', ref: 'wk000002' });
  });

  it('URGENCY: a name that is not in the directory goes in as PLAIN TEXT in one tap: no file, no medical form, the directory untouched', async () => {
    await mount();
    expect(q('crew-add-text')).toBeNull(); // nothing noisy while you just browse
    await type('Pedro Urgente');
    expect(listed()).toEqual([]);
    expect(q('crew-pick-hint').textContent).toBe('Nadie coincide: se añadirá como texto simple.');
    expect(q('crew-add-text').textContent).toBe('+ Añadir «Pedro Urgente»');
    await click(q('crew-add-text'));
    expect(spy.project.crew).toHaveLength(1);
    expect(spy.project.crew[0]).toMatchObject({ name: 'Pedro Urgente', specialty: 'multi' });
    expect(spy.project.crew[0]).not.toHaveProperty('ref');
    expect(loadWorkers()).toHaveLength(5);
    expect(host.querySelector('[data-testid="worker-block-safety"]')).toBeNull();
    expect(q('crew-search').value).toBe('');
    await type('');
    expect(q('crew-add-text')).toBeNull();
  });

  it('Enter in the bar adds the typed name too, with the active trade chip as its specialty', async () => {
    await mount();
    await trade('mason');
    await type('Luis Albañil');
    await act(async () => {
      q('crew-master').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(spy.project.crew[0]).toMatchObject({ name: 'Luis Albañil', specialty: 'mason' });
  });

  it('typing the exact name of someone in the directory links his file instead of creating a lookalike', async () => {
    await mount();
    await type('carla diaz');
    await act(async () => {
      q('crew-master').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(spy.project.crew[0]).toMatchObject({ name: 'Carla Díaz', ref: 'wk000003', specialty: 'plumber' });
    expect(spy.project.crew).toHaveLength(1);
  });

  it('a job with no city cannot filter by reach: says so and offers everybody', async () => {
    await mount({ cityOrRegion: '' });
    await trade('electrician');
    expect(q('crew-noplace').textContent).toContain('Indica la ciudad de la obra');
    expect(listed()).toEqual(['Beto Soto', 'Dante Mora', 'Ana Ruiz']); // no distance to rank by: best rated first
  });

  it('an empty directory: no distance capsules, a quiet note, and a name can still be typed in', async () => {
    localStorage.clear();
    await mount();
    expect(q('crew-range')).toBeNull();
    await type('Solo Texto');
    expect(q('crew-pick-hint').textContent).toContain('El directorio está vacío');
    await click(q('crew-add-text'));
    expect(spy.project.crew[0].name).toBe('Solo Texto');
  });

  it('Escape clears the search first (the sheet stays open)', async () => {
    await mount();
    await type('bet');
    await act(async () => q('crew-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(q('crew-search').value).toBe('');
    expect(q('crew-suggest')).toBeNull();
    expect(q('ws-crew-sheet')).not.toBeNull();
  });

  it('the person of the project is still edited with the old sheet (name, trade, notes) and keeps the directory link', async () => {
    await mount();
    await pick('wk000001');
    const id = spy.project.crew[0].id;
    await unfold(id);
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
    await pick('wk000001'); // Ana: allergy
    await pick('wk000002'); // Beto: nothing to warn about
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
    expect(q(`worker-toggle-${ana}`).getAttribute('aria-label')).toContain('⚠'); // announced with the name by a screen reader
    expect(q(`worker-toggle-${beto}`).getAttribute('aria-label')).not.toContain('⚠');
  });

  it('a limiting condition alone is enough to raise it', async () => {
    saveWorkers([{ id: 'wk000009', name: 'Fito Vega', specialties: ['mason'], rating: 2, address: 'Maipú', limiting: 'Vértigo: no trabajar en altura' }]);
    await mount();
    await pick('wk000009');
    expect(card(spy.project.crew[0].id)).not.toBeNull();
  });

  it('typed as plain text there is no file and no ⚠ (nothing is invented)', async () => {
    await mount();
    await typeInto(q('crew-search'), 'Pedro Urgente');
    await click(q('crew-add-text'));
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
    await pick('wk000001');
    const id = spy.project.crew[0].id;
    await unfold(id);
    await click(q(`worker-edit-${id}`));
    await typeInto(q('crew-notes'), 'Tablero');
    await click(q('crew-save'));
    expect(spy.project.crew[0]).toMatchObject({ ref: 'wk000001', health: true, notes: 'Tablero' });
    expect(card(id)).not.toBeNull();
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(spy.project)));
    expect(reloaded.crew[0]).toMatchObject({ ref: 'wk000001', health: true });
    expect(q(`worker-${id}`).contains(card(id))).toBe(true);
    expect(q(`worker-pay-${id}`)).not.toBeNull(); // the card keeps its own actions next to the warning
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

describe('emergency: the health data is READ on site (the person\'s sheet in the project)', () => {
  const FULL = { id: 'wk000009', name: 'Fito Vega', specialties: ['mason'], rating: 2, address: 'Maipú', limiting: 'Vértigo: no trabajar en altura', allergies: 'Penicilina, Látex', emergencyName: 'María Soto', emergencyPhone: '+56 9 8765 4321' };
  const open = async (name) => {
    const id = spy.project.crew.find((w) => w.name === name).id;
    await unfold(id);
    await click(q(`worker-edit-${id}`));
  };

  it('tapping a person with a health warning shows, at the TOP of the sheet, the conditions, allergies and emergency contact of the file, in an orange panel', async () => {
    saveWorkers([FULL]);
    await mount();
    await pick('wk000009');
    await open('Fito Vega');
    const panel = q('crew-emergency');
    expect(panel).not.toBeNull();
    for (const cls of ['bg-orange-500/10', 'border-orange-500/30', 'border', 'p-3', 'rounded-lg', 'mb-4']) expect(panel.className).toContain(cls);
    expect(panel.textContent).toContain('Aviso de salud');
    expect(q('crew-emergency-limiting').textContent).toContain('Condiciones limitantes');
    expect(q('crew-emergency-limiting').textContent).toContain('Vértigo: no trabajar en altura');
    expect(q('crew-emergency-allergies').textContent).toContain('Alergias');
    expect(q('crew-emergency-allergies').textContent).toContain('Penicilina, Látex');
    expect(q('crew-emergency-contact').textContent).toContain('Contacto de emergencia');
    expect(q('crew-emergency-contact-name').textContent).toBe('María Soto');
    expect(q('crew-emergency-phone').textContent).toBe('+56 9 8765 4321');
    expect(q('crew-emergency-phone').getAttribute('href')).toBe('tel:+56987654321'); // one tap to call
    // it comes BEFORE the editing form: it is the first thing of the sheet
    expect(panel.compareDocumentPosition(q('worker-form')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.querySelector('input, textarea, select, button')).toBeNull(); // read only
  });

  it('only what exists is shown; a missing emergency contact is said out loud', async () => {
    saveWorkers([{ ...FULL, limiting: '', emergencyName: '', emergencyPhone: '' }]);
    await mount();
    await pick('wk000009');
    await open('Fito Vega');
    expect(q('crew-emergency-limiting')).toBeNull();
    expect(q('crew-emergency-allergies').textContent).toContain('Penicilina');
    expect(q('crew-emergency-contact')).toBeNull();
    expect(q('crew-emergency-nocontact').textContent).toBe('Sin contacto de emergencia registrado.');
  });

  it('it follows the live file: after the notes of the file change, the next opening of the sheet reads the new text', async () => {
    saveWorkers([FULL]);
    await mount();
    await pick('wk000009');
    await open('Fito Vega');
    expect(q('crew-emergency-allergies').textContent).toContain('Penicilina');
    await click(qa('sheet-backdrop').at(-1));
    saveWorkers([{ ...FULL, allergies: 'Abejas' }]); // edited in Ajustes meanwhile
    await open('Fito Vega');
    expect(q('crew-emergency-allergies').textContent).toContain('Abejas');
    expect(q('crew-emergency-allergies').textContent).not.toContain('Penicilina');
  });

  it('NO panel for people with no health warning: plain text, a file with no notes, or a file with only an emergency contact', async () => {
    saveWorkers([{ id: 'wk000008', name: 'Gaby Paz', specialties: ['mason'], rating: 1, address: 'Maipú', emergencyName: 'Luis', emergencyPhone: '+56 9 1' }, ...DIRECTORY.slice(1, 2)]);
    await mount();
    await pick('wk000008');
    await typeInto(q('crew-search'), 'Pedro Urgente');
    await click(q('crew-add-text'));
    await pick('wk000002'); // Beto: no notes
    for (const name of ['Gaby Paz', 'Pedro Urgente', 'Beto Soto']) {
      await open(name);
      expect(q('worker-form'), name).not.toBeNull();
      expect(q('crew-emergency'), name).toBeNull();
      await click(qa('sheet-backdrop').at(-1));
    }
  });

  it('if the file was deleted the warning stays and the panel says that the details are gone (it never pretends there is nothing)', async () => {
    await mount({ ...place, crew: normalizeCrew([{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001', health: true }]) });
    act(() => root.unmount());
    root = createRoot(host);
    saveWorkers(DIRECTORY.filter((w) => w.id !== 'wk000001'));
    spy = {};
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: { ...newProject({ regionCode: 'CL', name: 'Casa' }), ...place, crew: normalizeCrew([{ id: 'crew0001', name: 'Ana Ruiz', specialty: 'electrician', ref: 'wk000001', health: true }]) } })));
    });
    await flush();
    await click(q('ws-crew'));
    await unfold('crew0001');
    await click(q('worker-edit-crew0001'));
    expect(q('crew-emergency')).not.toBeNull();
    expect(q('crew-emergency-gone').textContent).toContain('ya no está en el directorio');
    expect(q('crew-emergency-limiting')).toBeNull();
  });

  it('works in every language and the sheet still edits normally under the panel (name, trade, notes, delete)', async () => {
    saveWorkers([FULL]);
    await mount();
    await pick('wk000009');
    await open('Fito Vega');
    await typeInto(q('crew-notes'), 'Tablero');
    await click(q('crew-save'));
    expect(spy.project.crew[0]).toMatchObject({ name: 'Fito Vega', notes: 'Tablero', ref: 'wk000009', health: true });
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of ['crew.emergency.title', 'crew.emergency.noContact', 'crew.emergency.gone']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
  });
});

describe('emergency panel: the blood group, big and red', () => {
  const FILE = { id: 'wk000009', name: 'Fito Vega', specialties: ['mason'], rating: 2, address: 'Maipú', allergies: 'Penicilina', bloodType: 'O-', emergencyName: 'María', emergencyPhone: '+56 9 1' };
  const openSheet = async (name) => {
    await unfold(spy.project.crew.find((w) => w.name === name).id);
    await click(q(`worker-edit-${spy.project.crew.find((w) => w.name === name).id}`));
  };

  it('shows the group first in the orange panel as a red badge, large and semibold, announced with its label', async () => {
    saveWorkers([FILE]);
    await mount();
    await pick('wk000009');
    await openSheet('Fito Vega');
    const badge = q('crew-emergency-blood');
    expect(badge.textContent).toBe('O-');
    for (const cls of ['text-red-500', 'text-2xl', 'font-semibold', 'border-red-500/40', 'bg-red-500/10']) expect(badge.className).toContain(cls);
    expect(badge.className).not.toMatch(/font-(bold|extrabold|black)/);
    expect(badge.getAttribute('aria-label')).toBe('Grupo sanguíneo: O-');
    expect(q('crew-emergency').contains(badge)).toBe(true);
    // before the conditions / allergies / contact: it is the first thing read
    expect(badge.compareDocumentPosition(q('crew-emergency-allergies')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('crew-emergency-blood-none')).toBeNull();
  });

  it('every group of the closed list renders as written', async () => {
    for (const b of ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) {
      saveWorkers([{ ...FILE, bloodType: b }]);
      await mount();
      await pick('wk000009');
      await openSheet('Fito Vega');
      expect(q('crew-emergency-blood').textContent).toBe(b);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });

  it('a health panel with no group says it is not specified (never silence)', async () => {
    saveWorkers([{ ...FILE, bloodType: '' }]);
    await mount();
    await pick('wk000009');
    await openSheet('Fito Vega');
    expect(q('crew-emergency-blood')).toBeNull();
    expect(q('crew-emergency-blood-none').textContent).toBe('Grupo sanguíneo: no especificado');
  });

  it('the group alone is medical data: it opens the panel even with no allergy or condition (the card has no ⚠: that is only for risks)', async () => {
    saveWorkers([{ id: 'wk000008', name: 'Gaby Paz', specialties: ['mason'], rating: 1, address: 'Maipú', bloodType: 'B+' }]);
    await mount();
    await pick('wk000008');
    const id = spy.project.crew[0].id;
    expect(q(`worker-health-${id}`)).toBeNull();
    await openSheet('Gaby Paz');
    expect(q('crew-emergency-blood').textContent).toBe('B+');
    expect(q('crew-emergency-limiting')).toBeNull();
    expect(q('crew-emergency-allergies')).toBeNull();
    expect(q('crew-emergency-nocontact')).not.toBeNull();
  });

  it('a file with neither notes nor group still shows no panel', async () => {
    await mount();
    await pick('wk000002'); // Beto
    await openSheet('Beto Soto');
    expect(q('crew-emergency')).toBeNull();
  });

  it('every language names the group and its "not specified" state', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of ['squadra.blood', 'squadra.blood.none']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
  });
});
