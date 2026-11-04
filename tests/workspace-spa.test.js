// @vitest-environment happy-dom
// The SPA completed: crew + schedule, machinery rentals, finance, advances (all on the app's own numpad), the read-only
// lock, the client's signature from the export sheet, and the structure rules (one export module, no door to the old editor).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { SPECIALTY_ICON } from '../src/components/workspace/icons.jsx';
import { newProject, normalizeProject, toDayString } from '../src/lib/projects.js';
import { WORKER_SPECIALTIES, advancesByWorker, laborPool, liquidity, projectLiquidity } from '../src/lib/ledger.js';
import { computeAll } from '../src/lib/engine.js';
import { currentBook, resetRegistry } from '../src/lib/priceRegistry.js';
import { flushUserPrices } from '../src/lib/priceFeed.js';
import { resetToasts } from '../src/lib/notify.js';
import { freezeQuote } from '../src/lib/signature.js';
import { runExport } from '../src/lib/exportActions.js';
import { calendarDays, partidaMachines, rentRows, setMachineOn, toggleMachine, withAdvance, withMachinery, withProjectDates, withWorker, withWorkerEdited, withoutAdvance, withoutWorker } from '../src/lib/workspaceModel.js';
import { MACHINE_IDS } from '../src/lib/machinery.js';
import { DICT } from '../src/lib/dict.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
vi.mock('../src/components/SignatureSheet.jsx', async () => {
  const React = await import('react');
  return {
    default: ({ onSave, onSkip, skipLabel }) =>
      React.createElement(
        'div',
        { 'data-testid': 'sig-stub' },
        React.createElement('button', { 'data-testid': 'sig-accept', onClick: () => onSave({ dataUrl: 'data:image/png;base64,AAAA', w: 10, h: 10, name: 'Cliente', taxId: '1-9', at: 1, total: 1, pricedAt: 1 }) }, 'ok'),
        React.createElement('button', { 'data-testid': 'sig-skip', onClick: onSkip }, skipLabel)
      ),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};
const mk = (extra = {}, start = -5, end = 20) => {
  const p = newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana', startDate: day(start), endDate: day(end) });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 }; // 24 m², 2.4 m³: needs the mixer
  return { ...p, ...extra };
};
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

// ---- pure model --------------------------------------------------------------------------------------------------------
describe('model: crew, machinery, deadline', () => {
  it('a locked (frozen) quote still refuses machinery edits', () => {
    const d = mk().draft;
    const frozen = freezeQuote(d, { pricedAt: 1000, total: 5, live: {} });
    expect(withMachinery(frozen, { include: false })).toBe(frozen);
  });

  it('machinery: master switch + stable excluded list of known ids', () => {
    const d = mk().draft;
    expect(withMachinery(d, { include: false }).machinery).toMatchObject({ include: false, excluded: [] });
    expect(toggleMachine([], 'mixer', false)).toEqual(['mixer']);
    expect(toggleMachine(['mixer', 'mixer', 'nonsense'], 'mixer', true)).toEqual([]);
    expect(toggleMachine(['scaffold'], 'compactor', false)).toEqual(MACHINE_IDS.filter((x) => ['compactor', 'scaffold'].includes(x)));
  });

  it('withProjectDates: two manual dates; the start dragging the end, an end before the start and junk are refused', () => {
    const p = mk();
    expect(withProjectDates(p, { endDate: day(10) })).toMatchObject({ startDate: day(-5), endDate: day(10) });
    expect(withProjectDates(p, { startDate: day(30) })).toMatchObject({ startDate: day(30), endDate: day(30) }); // the end follows
    expect(withProjectDates(p, { endDate: day(-9) })).toBe(p); // before the start: refused
    expect(withProjectDates(p, { endDate: 'ayer' })).toBe(p);
    expect(withProjectDates(p, { endDate: p.endDate })).toBe(p); // no change
    expect(withProjectDates(p, { endDate: '' })).toMatchObject({ startDate: day(-5), endDate: '' });
    const locked = { ...p, draft: freezeQuote(p.draft, { pricedAt: 1000, total: 5, live: p }) };
    expect(withProjectDates(locked, { endDate: day(10) })).toBe(locked); // the dates set the machinery days: part of the locked quote
  });

  it('calendarDays is a plain subtraction of the two dates (null while one is missing)', () => {
    expect(calendarDays(mk())).toBe(25); // -5 .. +20
    expect(calendarDays({ startDate: day(0), endDate: day(0) })).toBe(0);
    expect(calendarDays({ startDate: day(0), endDate: day(1) })).toBe(1);
    expect(calendarDays({ startDate: '', endDate: day(1) })).toBeNull();
    expect(calendarDays({ startDate: day(0), endDate: '' })).toBeNull();
  });

  it('the crew is a nominal list: add / edit / remove, name required, unknown specialty = multi', () => {
    const p0 = { ...mk(), crew: [] };
    expect(withWorker(p0, { name: '  ', specialty: 'mason' })).toBe(p0);
    const p1 = withWorker(p0, { name: 'Luca Rossi', specialty: 'electrician', notes: 'Tablero' });
    expect(p1.crew).toHaveLength(1);
    expect(p1.crew[0]).toMatchObject({ name: 'Luca Rossi', specialty: 'electrician', notes: 'Tablero' });
    expect(withWorker(p1, { name: 'X', specialty: 'astronaut' }).crew[1].specialty).toBe('multi');
    const id = p1.crew[0].id;
    expect(withWorkerEdited(p1, id, { name: 'Luca R.', specialty: 'plumber', notes: '' }).crew[0]).toMatchObject({ id, name: 'Luca R.', specialty: 'plumber' });
    expect(withWorkerEdited(p1, 'nope', { name: 'Y' })).toBe(p1);
    expect(withoutWorker(p1, id).crew).toEqual([]);
    expect(withoutWorker(p1, 'nope')).toBe(p1);
  });

  it('advances are linked to a worker (workerId) and keep adding up in the ledger: pool, liquidity and the project cash', () => {
    const p0 = withWorker({ ...mk(), crew: [], payments: [{ id: 'pay1', amount: 10000, at: 1 }] }, { name: 'Ana', specialty: 'mason' });
    const p1 = withWorker(p0, { name: 'Beto', specialty: 'plumber' });
    const [ana, beto] = p1.crew;
    const p2 = withAdvance(withAdvance(withAdvance(p1, ana.id, 1500), beto.id, 700), ana.id, 300);
    expect(p2.advances.map((a) => [a.workerId, a.worker, a.amount])).toEqual([[ana.id, 'Ana', 300], [beto.id, 'Beto', 700], [ana.id, 'Ana', 1500]]);
    expect(withAdvance(p1, 'nadie', 100)).toBe(p1); // not a person of the crew
    expect(withAdvance(p1, ana.id, 0)).toBe(p1); // not an amount
    const split = advancesByWorker(p2.crew, p2.advances);
    expect(split.rows.map((r) => [r.worker.name, r.total])).toEqual([['Ana', 1800], ['Beto', 700]]);
    expect(split.loose).toEqual([]);
    // the cash book keeps summing EVERY advance, whoever got it
    expect(laborPool(5000, p2.advances)).toEqual({ pool: 5000, advanced: 2500, available: 2500 });
    expect(liquidity(p2.payments, [], p2.advances)).toBe(7500);
    expect(projectLiquidity(p2)).toBe(7500);
    // removing a person keeps the money in the book, as unassigned
    const p3 = withoutWorker(p2, ana.id);
    expect(projectLiquidity(p3)).toBe(7500);
    const split3 = advancesByWorker(p3.crew, p3.advances);
    expect(split3.looseTotal).toBe(1800);
    expect(split3.rows.reduce((s2, r) => s2 + r.total, 0) + split3.looseTotal).toBe(2500);
    expect(withoutAdvance(p2, p2.advances[0].id).advances).toHaveLength(2);
  });

  it('normalizeProject keeps crew and workerId (and an old project without them still loads)', () => {
    const w = withWorker({ ...mk(), crew: [] }, { name: 'Ana', specialty: 'mason' });
    const withAdv = withAdvance(w, w.crew[0].id, 900);
    const back = normalizeProject(JSON.parse(JSON.stringify(withAdv)));
    expect(back.crew).toEqual(withAdv.crew);
    expect(back.advances[0]).toMatchObject({ workerId: w.crew[0].id, worker: 'Ana', amount: 900 });
    const old = JSON.parse(JSON.stringify(mk()));
    delete old.crew;
    old.advances = [{ id: 'adv1abc', worker: 'Juan', amount: 50, at: 5 }];
    const loaded = normalizeProject(old);
    expect(loaded.crew).toEqual([]);
    expect(loaded.advances[0].workerId).toBeUndefined();
  });

  it('rentRows read the engine result; an incomplete quote has none (the engine still prices the machinery rental)', () => {
    const p = mk();
    const r = computeAll(p.draft, Date.now(), { timeline: { startDate: p.startDate, endDate: p.endDate }, chains: false });
    expect(rentRows(r).map((x) => x.id)).toContain('mixer');
    const empty = computeAll(newProject({ regionCode: 'CL' }).draft, Date.now(), { chains: false });
    expect(rentRows(empty)).toEqual([]);
  });
});

// ---- the screen ---------------------------------------------------------------------------------------------------------
let host;
let root;
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
const keys = async (s) => {
  for (const k of s) await click(q(`pad-${k}`));
};

function Harness({ initial, spy }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} }),
    React.createElement(ToastHost)
  );
}
let spy;
const mount = async (initial) => {
  spy = {};
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial, spy })));
  });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  runExport.mockClear();
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

describe('Squadra e cronoprogramma (manual dates + nominal crew)', () => {
  it('the summary pluralizes in every language (1 vs many)', () => {
    const one = { es: 'trabajador', en: 'worker', pt: 'trabalhador', fr: 'ouvrier', it: 'lavoratore', de: 'Mitarbeiter' };
    const many = { es: 'trabajadores', en: 'workers', pt: 'trabalhadores', fr: 'ouvriers', it: 'lavoratori', de: 'Mitarbeiter' };
    for (const l of Object.keys(one)) {
      expect(DICT[l]['ws.crew.count1'], l).toBe(`{n} ${one[l]}`);
      expect(DICT[l]['ws.crew.countN'], l).toBe(`{n} ${many[l]}`);
    }
    expect(DICT.it['ws.crew.count1'].replace('{n}', '1')).toBe('1 lavoratore');
    expect(DICT.it['ws.crew.countN'].replace('{n}', '2')).toBe('2 lavoratori');
  });

  const openCrew = async () => {
    await click(q('ws-crew'));
  };
  const addWorker = async (name, specialty = null, notes = '') => {
    await click(q('crew-add'));
    await typeInto(q('crew-name'), name);
    if (specialty) await click(q(`crew-filter-${specialty}`)); // the trade chip becomes the specialty of a person added as plain text
    await click(q('crew-save'));
    if (notes) {
      // the picker adds fast (name + trade); the optional line of tasks is written from the person's card
      const id = spy.project.crew.at(-1).id;
      await click(q(`worker-edit-${id}`));
      await typeInto(q('crew-notes'), notes);
      await click(q('crew-save'));
    }
  };

  it('the theoretical engine is gone from the screen: no HH, dead days, timeline bars, recalculate button or [-] [+] counter', async () => {
    await mount(mk());
    const crew = q('ws-crew');
    for (const id of ['sched-window', 'sched-timeline', 'sched-deadline', 'crew-auto', 'crew-plus', 'crew-minus', 'crew-count', 'crew-deadline', 'crew-pad', 'days-pad']) expect(q(id), id).toBeNull();
    expect(crew.textContent).not.toMatch(/\bHH\b/);
    expect(crew.querySelector('[aria-hidden="true"].bg-brand')).toBeNull();
  });

  it('two plain date fields (inicio / entrega) edit the project and the duration is the subtraction, shown statically', async () => {
    await mount(mk());
    await openCrew();
    expect(q('crew-start').type).toBe('date');
    expect(q('crew-start').value).toBe(day(-5));
    expect(q('crew-end').value).toBe(day(20));
    expect(q('crew-duration').dataset.days).toBe('25');
    expect(q('crew-duration').textContent).toContain('25 días');
    await typeInto(q('crew-end'), day(24));
    expect(spy.project.endDate).toBe(day(24));
    expect(q('crew-duration').dataset.days).toBe('29');
    await typeInto(q('crew-start'), day(-4));
    expect(spy.project.startDate).toBe(day(-4));
    expect(q('crew-duration').dataset.days).toBe('28');
    await typeInto(q('crew-end'), day(-4));
    expect(q('crew-duration').textContent).toContain('0 días');
    await typeInto(q('crew-end'), '');
    expect(spy.project.endDate).toBe('');
    expect(q('crew-duration').textContent).toContain('—');
  });

  it('"+ Añadir trabajador" unfolds the selector dropdown (name, trade filters, optional notes later); the person shows up as a minimal row', async () => {
    await mount(mk());
    await openCrew();
    expect(q('crew-empty')).not.toBeNull();
    await click(q('crew-add'));
    expect(q('worker-form')).not.toBeNull();
    expect([...q('crew-filters').querySelectorAll('button')].map((b) => b.dataset.testid.replace('crew-filter-', ''))).toEqual(WORKER_SPECIALTIES);
    expect(q('crew-save')).toBeNull(); // a name is required: the add-as-text button appears once something is typed
    await typeInto(q('crew-name'), 'Luca Rossi');
    expect(q('crew-save').disabled).toBe(false);
    await click(q('crew-add')); // folding the dropdown without saving adds nobody
    expect(q('worker-form')).toBeNull();
    expect(spy.project.crew).toHaveLength(0);
    await addWorker('Luca Rossi', 'electrician', 'Tablero general');
    expect(q('worker-form')).toBeNull();
    expect(spy.project.crew).toHaveLength(1);
    const w = spy.project.crew[0];
    expect(w).toMatchObject({ name: 'Luca Rossi', specialty: 'electrician', notes: 'Tablero general' });
    const card = q(`worker-${w.id}`);
    expect(card.dataset.specialty).toBe('electrician');
    expect(q(`worker-name-${w.id}`).textContent).toBe('Luca Rossi');
    expect(card.querySelector('[data-testid^="worker-spec-"]')).toBeNull(); // the row is minimal: no specialty line, no role icon
    expect(card.querySelector(`[data-testid="worker-edit-${w.id}"] svg`)).toBeNull();
    expect(q('crew-empty')).toBeNull();
    expect(q('ws-crew').textContent).toContain('1 trabajador');
    expect(q('ws-crew').textContent).not.toContain('1 trabajadores');
    await addWorker('Pía', 'plumber');
    expect(q('ws-crew').textContent).toContain('2 trabajadores');
    await addWorker('Nico');
    const [, plumber, generic] = spy.project.crew;
    expect(q(`worker-${plumber.id}`).dataset.specialty).toBe('plumber');
    expect(generic.specialty).toBe('multi');
    expect(q(`worker-${generic.id}`).dataset.specialty).toBe('multi');
  });

  it('the advance button is a COMPACT action on the name\'s own line: [coins Anticipo], green, no menu to open, no full-width block', async () => {
    await mount(mk());
    await openCrew();
    await addWorker('Luca', 'electrician');
    const id = spy.project.crew[0].id;
    const btn = q(`worker-adv-${id}`);
    expect(btn.closest(`[data-testid="worker-${id}"]`)).not.toBeNull(); // inside the card itself
    expect(btn.closest('[data-testid="ws-crew-sheet"]')).not.toBeNull();
    expect(btn.closest('details')).toBeNull(); // no hidden accordion / menu of its own
    expect(btn.textContent).toBe('Anticipo'); // short label; the icon says the rest
    expect(btn.className).toContain('border-emerald-500');
    expect(btn.className).toContain('text-emerald-400');
    expect(btn.className).not.toMatch(/\bw-full\b/); // not a block
    expect(btn.className).not.toMatch(/\bbg-(?!black)/); // OLED: black ground
    expect(btn.className).toMatch(/min-h-\[(4[4-9]|5\d)px\]/); // still a comfortable touch target
    // same row as the name: edit button and advance button are siblings in ONE flex line
    expect(btn.previousElementSibling).toBe(q(`worker-edit-${id}`));
    expect(btn.parentElement.className).toContain('flex');
    // COINS (a stack + a single coin), never a bill / block
    const icon = btn.querySelector('svg[data-outline-icon="true"][data-icon="coins"]');
    expect(icon).not.toBeNull();
    expect(icon.querySelector('ellipse')).not.toBeNull();
    expect(icon.querySelectorAll('circle').length).toBeGreaterThanOrEqual(1);
    expect(icon.querySelector('rect')).toBeNull();
    expect(DICT.it['ws.crew.advance']).toBe('Anticipo');
    // it comes right after the header of the card, before the history
    const card = q(`worker-${id}`);
    const order = [...card.querySelectorAll('button')].map((b) => b.dataset.testid);
    expect(order.slice(0, 2)).toEqual([`worker-edit-${id}`, `worker-adv-${id}`]);
  });

  it('high-density sheet: expanded (85 % of the screen), the schedule is ONE pill line "📅 start ➔ end (N días)"', async () => {
    await mount(mk());
    await openCrew();
    expect(q('ws-crew-sheet').closest('[role="dialog"]').className).toContain('h-[85vh]');
    const pill = q('crew-dates');
    expect(pill.className).toContain('rounded-full');
    expect(pill.textContent).toContain('📅');
    expect(pill.textContent).toContain('➔');
    expect(pill.textContent).toMatch(/\((\d+ días?|—)\)/);
    // both dates and the duration live in that single pill; the old big labelled fields and the duration card are gone
    expect(pill.contains(q('crew-start'))).toBe(true);
    expect(pill.contains(q('crew-end'))).toBe(true);
    expect(pill.contains(q('crew-duration'))).toBe(true);
    expect(pill.querySelector('.label')).toBeNull();
    expect(q('ws-crew-sheet').textContent).not.toContain('Duración (días corridos)');
    // the pill still edits the real dates
    await typeInto(q('crew-end'), day(24));
    expect(q('crew-duration').dataset.days).toBe(String(Math.round((new Date(day(24)) - new Date(spy.project.startDate)) / 86400000)));
  });

  it('control line above the list: round [+] on the left, "Mano de obra: X (Gastado: Y)" on the right; no big bottom button or budget text', async () => {
    await mount(mk());
    await openCrew();
    await addWorker('Juan');
    const bar = q('crew-bar');
    const add = q('crew-add');
    expect(bar.contains(add)).toBe(true);
    expect(add.className).toContain('rounded-full');
    expect(add.className).toMatch(/h-11 w-11/);
    expect(add.textContent.trim()).toBe('+');
    expect(add.getAttribute('aria-label')).toBe('+ Añadir trabajador');
    expect(bar.firstElementChild).toBe(add); // left
    const pool = q('labor-pool');
    expect(bar.contains(pool)).toBe(true);
    expect(pool.className).toContain('text-right'); // right
    expect(pool.textContent).toMatch(/^Mano de obra: .*\(Gastado: .*\)$/);
    // the bar is ABOVE the list; nothing of the old footer remains
    const list = q('crew-list');
    expect(bar.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('ws-crew-sheet').textContent).not.toContain('Mano de obra disponible');
    expect(qa('crew-add')).toHaveLength(1);
    // the balance is read before handing out an advance: it moves when one is given
    const before = Number(pool.dataset.available);
    const id = spy.project.crew[0].id;
    await click(q(`worker-adv-${id}`));
    await keys('2500');
    await click(q('pad-done'));
    expect(Number(q('labor-pool').dataset.available)).toBe(before - 2500);
    expect(Number(q('labor-pool').dataset.spent)).toBe(2500);
  });

  it('MINIMAL row: only the name, the ⚠ (when it applies) and the compact advance button on one line; the advances detail lives behind the edit mode', async () => {
    await mount(mk());
    await openCrew();
    await addWorker('Luca', 'electrician');
    const id = spy.project.crew[0].id;
    const card = q(`worker-${id}`);
    const line = q(`worker-edit-${id}`).parentElement;
    expect(line.className).toContain('flex');
    expect(line.contains(q(`worker-adv-${id}`))).toBe(true);
    expect(q(`worker-edit-${id}`).querySelector('svg')).toBeNull(); // no role icon
    expect(q(`worker-spec-${id}`)).toBeNull(); // no specialty line
    expect([...card.querySelectorAll('button')].map((b) => b.dataset.testid)).toEqual([`worker-edit-${id}`, `worker-adv-${id}`]); // nothing else is tappable
    await click(q(`worker-adv-${id}`));
    await keys('1000');
    await click(q('pad-done'));
    expect(q(`worker-advlist-${id}`)).toBeNull(); // the detail is quiet by default...
    expect(q(`worker-total-${id}`).dataset.total).toBe('1000'); // ...but the TOTAL already advanced is always on the row, passive
    expect(q(`worker-edit-${id}`).contains(q(`worker-total-${id}`))).toBe(true);
    for (const cls of ['text-neutral-400', 'text-xs', 'font-medium']) expect(q(`worker-total-${id}`).className).toContain(cls);
    expect(q(`worker-total-${id}`).nextElementSibling).toBeNull();
    expect(q(`worker-total-${id}`).closest('div').contains(q(`worker-adv-${id}`))).toBe(true); // same line as the advance button
    await click(q('crew-edit-toggle'));
    const list = q(`worker-advlist-${id}`);
    expect(card.contains(list)).toBe(true);
    expect(line.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // under the line, no accordion
    expect(q(`worker-total-${id}`).dataset.total).toBe('1000');
  });

  it('the [+] opens the personnel selector with the proximity radar (Local / Regional / Todos) and the trade filters', async () => {
    await mount(mk());
    await openCrew();
    await click(q('crew-add'));
    expect(q('crew-range')).not.toBeNull();
    expect([...q('crew-range').querySelectorAll('button')].map((b) => b.dataset.testid)).toEqual(['crew-range-local', 'crew-range-regional', 'crew-range-all']);
    expect(q('crew-filters')).not.toBeNull();
    expect(q('crew-directory') ?? q('crew-pick-hint') ?? q('crew-noplace')).not.toBeNull();
  });

  it('the specialty list covers the trades of the job site, each with its own icon and a translation in the six languages', async () => {
    for (const s2 of ['painter', 'tiler', 'drywaller', 'smith', 'operator', 'glazier', 'foreman']) expect(WORKER_SPECIALTIES, s2).toContain(s2);
    expect(WORKER_SPECIALTIES[0]).toBe('multi');
    expect(WORKER_SPECIALTIES.at(-1)).toBe('other');
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const sp of WORKER_SPECIALTIES) expect(DICT[l][`ws.spec.${sp}`], `${l}:${sp}`).toBeTruthy();
    expect(['Pittore', 'Piastrellista', 'Cartongessista', 'Fabbro', 'Autista / Macchinista', 'Serramentista', 'Capocantiere'].every((n) => Object.values(DICT.it).includes(n))).toBe(true);
    // every trade draws a different icon, except the two generic ones
    const icons = WORKER_SPECIALTIES.map((sp) => SPECIALTY_ICON[sp]);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(WORKER_SPECIALTIES.length - 1); // multi and other share the generic User
    expect(SPECIALTY_ICON.multi).toBe(SPECIALTY_ICON.other);
    // the model accepts them all; an unknown one is still "multi"
    const p0 = { ...mk(), crew: [] };
    let p = p0;
    for (const sp of WORKER_SPECIALTIES) p = withWorker(p, { name: `W ${sp}`, specialty: sp });
    expect(p.crew.map((w) => w.specialty)).toEqual(WORKER_SPECIALTIES);
    expect(withWorker(p0, { name: 'X', specialty: 'astronaut' }).crew[0].specialty).toBe('multi');
    // the select lists them all and the card shows the icon + the label of a new trade
    await mount(mk());
    await openCrew();
    await click(q('crew-add'));
    expect([...q('crew-filters').querySelectorAll('button')].map((b) => b.dataset.testid.replace('crew-filter-', ''))).toEqual(WORKER_SPECIALTIES);
    await click(q('crew-add')); // fold the dropdown
    await addWorker('Pía', 'painter');
    await addWorker('Tito', 'operator');
    await addWorker('Jefe', 'foreman');
    const [pia, tito, jefe] = spy.project.crew;
    expect([pia.specialty, tito.specialty, jefe.specialty]).toEqual(['painter', 'operator', 'foreman']);
    expect(q(`worker-${pia.id}`).dataset.specialty).toBe('painter');
  });

  it('a worker is edited and deleted from their card; their advances stay in the book as unassigned', async () => {
    await mount(mk());
    await openCrew();
    await addWorker('Ana', 'mason');
    const id = spy.project.crew[0].id;
    await click(q(`worker-edit-${id}`));
    expect(q('crew-name').value).toBe('Ana');
    await typeInto(q('crew-name'), 'Ana María');
    await click(q('crew-save'));
    expect(spy.project.crew[0]).toMatchObject({ id, name: 'Ana María', specialty: 'mason' });
    await click(q(`worker-adv-${id}`));
    await keys('800');
    await click(q('pad-done'));
    expect(spy.project.advances).toHaveLength(1);
    await click(q(`worker-edit-${id}`));
    await click(q('crew-delete'));
    expect(spy.project.crew).toHaveLength(0);
    expect(spy.project.advances).toHaveLength(1); // the money already handed over stays
    expect(q('advances-loose').dataset.total).toBe('800');
    expect(q('advances-loose').querySelector('button')).toBeNull(); // its delete only exists in edit mode
    await click(q('crew-edit-toggle'));
    await click(q('advances-loose').querySelector('button'));
    expect(spy.project.advances).toHaveLength(0);
  });

  it('"+ Anticipo" on a card opens the app numpad (no OS keyboard); the advance is linked to that person, shown in their card and discounts the labour pool', async () => {
    await mount(mk());
    await openCrew();
    await addWorker('Juan');
    await addWorker('Marta');
    const [juan, marta] = spy.project.crew;
    const pool0 = Number(q('labor-pool').dataset.available);
    expect(pool0).toBeGreaterThan(0);
    expect(q(`worker-total-${juan.id}`)).toBeNull(); // nothing advanced yet: nothing to show
    await click(q(`worker-adv-${juan.id}`));
    expect(q('advance-pad')).not.toBeNull();
    expect(host.querySelector('input:focus')).toBeNull();
    await keys('5000');
    await click(q('pad-done'));
    expect(q('advance-pad')).toBeNull();
    expect(spy.project.advances).toHaveLength(1);
    expect(spy.project.advances[0]).toMatchObject({ workerId: juan.id, worker: 'Juan', amount: 5000 });
    expect(q(`worker-total-${juan.id}`).dataset.total).toBe('5000');
    expect(q(`worker-total-${marta.id}`)).toBeNull();
    await click(q(`worker-adv-${marta.id}`));
    await keys('1200');
    await click(q('pad-done'));
    await click(q(`worker-adv-${juan.id}`));
    await keys('300');
    await click(q('pad-done'));
    expect(q(`worker-total-${juan.id}`).dataset.total).toBe('5300'); // the row's total adds up
    await click(q('crew-edit-toggle')); // the detail of each advance is read (and can be deleted) in edit mode
    expect(q(`worker-advlist-${juan.id}`).children).toHaveLength(2);
    expect(q(`worker-total-${marta.id}`).dataset.total).toBe('1200');
    expect(Number(q('labor-pool').dataset.available)).toBe(pool0 - 6500); // the pool discounts EVERY advance
    await click(q(`worker-advlist-${juan.id}`).querySelector('button'));
    expect(Number(q('labor-pool').dataset.available)).toBe(pool0 - 6200);
  });

  it('a pad closed with nothing typed (or cleared back to nothing) registers no advance', async () => {
    await mount(mk());
    await openCrew();
    await addWorker('Juan');
    const id = spy.project.crew[0].id;
    await click(q(`worker-adv-${id}`));
    await click(q('pad-done'));
    expect(spy.project.advances).toHaveLength(0);
    await click(q(`worker-adv-${id}`));
    await keys('5');
    await click(q('pad-back'));
    await click(q('pad-done'));
    expect(spy.project.advances).toHaveLength(0);
    await click(q(`worker-adv-${id}`));
    await keys('50');
    await click(q('pad-back'));
    await keys('0');
    await click(q('pad-done'));
    expect(spy.project.advances[0].amount).toBe(50);
  });
});

describe('Maquinaria en uso, inside the task (numpad + real time)', () => {
  it('the task lists its machines (icon, name, qty x days, rate, state); the module is gone from the main list', async () => {
    await mount(mk());
    expect(q('ws-machinery')).toBeNull(); // no module of its own...
    const box = q('partida-machinery-0'); // ...it lives inside the task
    expect(box.closest('[data-testid="partida-0"]')).not.toBeNull();
    expect(box.textContent).toContain('Maquinaria en uso');
    const row = q('partida-machine-0-mixer');
    expect(row.dataset.included).toBe('true');
    expect(row.querySelector('svg[data-outline-icon="true"]').getAttribute('stroke')).toBe('currentColor');
    expect(row.textContent).toContain('Trompo hormigonero');
    expect(row.textContent).toContain('En uso');
    expect(row.textContent).toMatch(/1 × \d+ d × /); // quantity x days x rate
    expect(q('partida-machine-rate-0-mixer').textContent).toMatch(/\d/);
    expect(box.className).not.toMatch(/bg-/); // black background, no boxes
    expect(row.className).not.toMatch(/font-(bold|extrabold|black|semibold)/); // regular weights
    for (const el of box.querySelectorAll('*')) expect(String(el.className?.baseVal ?? el.className)).not.toMatch(/font-(bold|extrabold|black|semibold)/);
  });

  it('the daily rate is typed on the pad: the quote recalculates at once and it is saved as the user rate', async () => {
    await mount(mk());
    const total0 = q('ws-total').textContent;
    await click(q('partida-machine-rate-0-mixer'));
    expect(q('rent-pad')).not.toBeNull();
    await keys('99999');
    expect(q('ws-total').textContent).not.toBe(total0);
    expect(currentBook('CL')?.user?.rent?.mixer).toBe(99999);
    expect(q('partida-machine-rate-0-mixer').dataset.source).toBe('saved');
    await click(q('pad-reset'));
    expect(currentBook('CL')?.user?.rent?.mixer).toBeUndefined();
    await click(q('pad-done'));
    await flushUserPrices();
  });

  it('removing / adding a machine from the task changes the quote; adding it back after "all off" re-enables only that one', async () => {
    await mount(mk());
    const total0 = q('ws-total').textContent;
    await click(q('partida-machine-toggle-0-mixer'));
    expect(spy.project.draft.machinery.excluded).toContain('mixer');
    expect(q('partida-machine-0-mixer').dataset.included).toBe('false');
    expect(q('partida-machine-0-mixer').textContent).toContain('Excluida');
    expect(q('ws-total').textContent).not.toBe(total0);
    await click(q('partida-machine-toggle-0-mixer')); // back in
    expect(spy.project.draft.machinery.excluded).not.toContain('mixer');
    expect(q('ws-total').textContent).toBe(total0);
  });

  it('model: setMachineOn with the master switch off turns machinery on with ONLY that machine', () => {
    const d = { ...mk().draft, machinery: { include: false, excluded: [] } };
    const next = setMachineOn(d, 'mixer', true);
    expect(next.machinery.include).toBe(true);
    expect(next.machinery.excluded).toEqual(MACHINE_IDS.filter((x) => x !== 'mixer'));
    const off = setMachineOn(mk().draft, 'mixer', false);
    expect(off.machinery.excluded).toEqual(['mixer']);
    const frozen = freezeQuote(mk().draft, { pricedAt: 1000, total: 5, live: {} });
    expect(setMachineOn(frozen, 'mixer', false)).toBe(frozen); // locked: read-only
  });

  it('the section title and states exist in six languages ("Macchinari in uso" in Italian)', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of ['ws.mach.inUse', 'ws.mach.on', 'ws.mach.off']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
    expect(DICT.it['ws.mach.inUse']).toBe('Macchinari in uso');
    expect(DICT.es['ws.mach.inUse']).toBe('Maquinaria en uso');
  });

  it('each task lists only ITS machines (index based), with their rate rows', () => {
    const p = mk();
    const r = computeAll(p.draft, Date.now());
    const mine = partidaMachines(r, 0, 'CL');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.partida === 0)).toBe(true);
    expect(mine.every((m) => m.row?.id === m.id)).toBe(true);
    expect(partidaMachines(r, 7, 'CL')).toEqual([]);
  });
});

describe('finance + expenses inside the same screen', () => {
  it('the selectors (sliders) move the total; a rented tool has its return switch', async () => {
    const p = mk({ expenses: [{ id: 'e1', description: 'Taladro', category: 'tool_rental', supplier: 'Easy', amount: 25000, returnDate: day(3), returned: false }] });
    await mount(p);
    const total0 = q('ws-total').textContent;
    await click(q('ws-finance'));
    await click(q('finance-edit-toggle')); // the parameters start locked: the pencil turns the edit mode on
    const slider = q('slider-profit-input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '20');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(spy.project.draft.finance.profit).toBe(20);
    expect(q('ws-total').textContent).not.toBe(total0);
    await click(qa('sheet-backdrop').at(-1)); // close the Parámetros sheet
    await click(q('ws-expenses'));
    await click(q('expense-return-e1'));
    expect(spy.project.expenses[0].returned).toBe(true);
  });
});

describe('Parametri del preventivo: error-prevention lock', () => {

  it('starts locked: inputs disabled, dimmed, numbers still high-contrast; NO padlock button anywhere, a pencil in the header instead', async () => {
    await mount(mk());
    await click(q('ws-finance'));
    const params = q('finance-params');
    expect(params.disabled).toBe(true);
    expect(params.dataset.safe).toBe('true');
    for (const k of ['labor', 'transport', 'contingency', 'profit']) {
      expect(q(`slider-${k}-input`).disabled).toBe(true);
      expect(q(`slider-${k}-input`).className).toContain('slider-locked'); // cement grey rail, not a dimmed green
      expect(q(`slider-${k}-value`).className).toContain('text-neutral-200'); // the number is not dimmed
      expect(q(`slider-${k}-value`).className).not.toContain('bg-brand');
    }
    expect(q('finance-lock')).toBeNull(); // the padlock is gone
    expect(q('ws-finance-sheet').querySelector('svg rect')).toBeNull();
    const dialog = q('ws-finance-sheet').closest('[role="dialog"]');
    expect(dialog.querySelector('[data-sheet-close]')).toBeNull(); // and so is the x
    const pencil = q('finance-edit-toggle');
    expect(dialog.querySelector('h2').nextElementSibling.contains(pencil)).toBe(true); // top right
    expect(pencil.querySelector('svg[data-icon="pencil"]')).not.toBeNull();
    expect(pencil.getAttribute('aria-pressed')).toBe('false');
    expect(pencil.className).not.toMatch(/\b(border|bg-(?!transparent)|ring|shadow)/); // floating, no box
  });

  it('the pencil enables the controls (a check while on); touching it again locks them', async () => {
    await mount(mk());
    await click(q('ws-finance'));
    await click(q('finance-edit-toggle'));
    const toggle = q('finance-edit-toggle');
    expect(q('finance-params').disabled).toBe(false);
    expect(q('slider-profit-input').disabled).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Terminar edición');
    expect(toggle.querySelector('svg[data-icon="check"]')).not.toBeNull();
    await click(toggle);
    expect(q('finance-params').disabled).toBe(true);
    expect(q('finance-edit-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('closing and reopening the section locks it again', async () => {
    await mount(mk());
    await click(q('ws-finance'));
    await click(q('finance-edit-toggle'));
    expect(q('finance-params').disabled).toBe(false);
    await click(q('sheet-backdrop')); // close the sheet (tap outside)
    await click(q('ws-finance')); // enter again
    expect(q('finance-params').disabled).toBe(true);
    expect(q('finance-edit-toggle').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('read-only while locked', () => {
  const lockedProject = () => {
    const p = mk();
    return { ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) };
  };

  it('every editor of the quote is a disabled fieldset with a shield: a tap answers "Precios bloqueados" and nothing changes', async () => {
    await mount(lockedProject());
    await click(q('ws-finance')); // the finance parameters live in their sheet
    expect(qa('locked-shield').length).toBeGreaterThanOrEqual(2); // partida, finance (the crew is operational, not part of the quote)
    expect(q('slider-profit-input').closest('fieldset').disabled).toBe(true);
    expect(q('partida-0').querySelector('fieldset').disabled).toBe(true);
    expect(q('partida-machine-rate-0-mixer').closest('fieldset').disabled).toBe(true); // the machines of the task too
    const before = spy.project.draft;
    await click(qa('locked-shield')[1]);
    expect(q('toast').textContent).toBe('Precios bloqueados');
    expect(spy.project.draft).toBe(before);
    expect(q('rent-pad')).toBeNull();
    await click(q('partida-add') ?? qa('locked-shield')[0]);
  });

  it('the Start / Delivery dates are read-only behind the shield while locked; the people and their advances stay editable', async () => {
    await mount(lockedProject());
    await click(q('ws-crew'));
    const dates = q('crew-dates');
    expect(dates.closest('fieldset').disabled).toBe(true);
    expect(q('crew-start').closest('fieldset').disabled).toBe(true); // the inputs sit inside the disabled fieldset: no focus, no keyboard
    expect(q('crew-end').closest('fieldset').disabled).toBe(true);
    const shield = dates.closest('[data-locked="true"]').querySelector('[data-testid="locked-shield"]');
    const before = spy.project;
    await click(shield);
    expect(q('toast').textContent).toBe('Precios bloqueados');
    expect(spy.project.startDate).toBe(before.startDate);
    expect(spy.project.endDate).toBe(before.endDate);
    expect(q('crew-duration').dataset.days).toBe('25'); // still shown (statically)
    // operational: NOT locked
    expect(q('crew-add').closest('fieldset')).toBeNull();
    await click(q('crew-add'));
    await typeInto(q('crew-name'), 'Luca');
    await click(q('crew-save'));
    expect(spy.project.crew).toHaveLength(1);
    const id = spy.project.crew[0].id;
    expect(q(`worker-adv-${id}`).closest('fieldset')).toBeNull();
    await click(q(`worker-adv-${id}`));
    await keys('900');
    await click(q('pad-done'));
    expect(spy.project.advances[0]).toMatchObject({ workerId: id, amount: 900 });
    expect(spy.project.draft).toBe(before.draft); // the frozen quote did not move
  });

  it('unlocking makes every editor live again', async () => {
    await mount(lockedProject());
    await click(q('ws-unlock'));
    await click(q('unlock-confirm'));
    expect(qa('locked-shield')).toHaveLength(0);
    await click(q('ws-crew'));
    expect(q('crew-start').closest('fieldset')).toBeNull();
    await typeInto(q('crew-end'), day(24));
    expect(spy.project.endDate).toBe(day(24));
  });
});

describe('PDF Cliente + client signature', () => {
  it('"PDF Cliente" asks for the signature; signing locks the whole screen (🔒) and the signed PDF is generated by exportActions', async () => {
    await mount(mk());
    await click(q('dock-export'));
    await click(q('export-client'));
    expect(q('sig-stub')).not.toBeNull();
    expect(runExport).not.toHaveBeenCalled(); // not before the client signs
    await click(q('sig-accept'));
    const sig = spy.project.draft.signature;
    expect(sig).toMatchObject({ name: 'Cliente' });
    expect(sig.timeline).toEqual({ startDate: day(-5), endDate: day(20) }); // stamped like the wizard did
    expect(q('ws-lock-chip').textContent).toContain('Firmada');
    expect(q('project-workspace').dataset.locked).toBe('signed');
    expect(runExport).toHaveBeenCalledTimes(1);
    const [kind, ctx] = runExport.mock.calls[0];
    expect(kind).toBe('client');
    expect(ctx.project.draft.signature).toMatchObject({ name: 'Cliente' }); // the PDF sees the signature
    expect(qa('locked-shield').length).toBeGreaterThan(0); // read-only now
    await click(q('price-cement_bag'));
    expect(qa('toast').map((x) => x.textContent)).toContain('Precios bloqueados');
  });

  it('"Exportar sin firma" still delivers the client PDF (exportActions freezes the quote); the contractor PDF and Excel skip the signature', async () => {
    await mount(mk());
    await click(q('dock-export'));
    await click(q('export-client'));
    await click(q('sig-skip'));
    expect(runExport).toHaveBeenCalledTimes(1);
    expect(runExport.mock.calls[0][0]).toBe('client');
    expect(runExport.mock.calls[0][1].project.draft.signature).toBeNull();
    runExport.mockClear();
    await click(q('dock-export'));
    await click(q('export-tech'));
    expect(runExport.mock.calls[0][0]).toBe('tech');
    expect(q('sig-stub')).toBeNull();
    await click(q('dock-export'));
    await click(q('export-xlsx'));
    expect(runExport.mock.calls[1][0]).toBe('xlsx');
  });

  it('an already signed quote exports the client PDF straight away', async () => {
    const p = mk();
    const signed = { ...p, draft: { ...p.draft, signature: { dataUrl: 'data:image/png;base64,AAAA', w: 10, h: 10, name: 'X', taxId: '', at: 1, total: 1, pricedAt: Date.now(), timeline: { startDate: p.startDate, endDate: p.endDate } } } };
    await mount(signed);
    await click(q('dock-export'));
    await click(q('export-client'));
    expect(q('sig-stub')).toBeNull();
    expect(runExport.mock.calls[0][0]).toBe('client');
  });
});

describe('structure: one export module, no old editor, OLED black', () => {
  const workspaceFiles = () => [
    'src/components/ProjectWorkspace.jsx',
    ...fs.readdirSync(path.resolve(__dirname, '../src/components/workspace')).map((f) => `src/components/workspace/${f}`),
  ];

  it('ProjectWorkspace stays under 500 lines and never imports the old screens', () => {
    const src = read('src/components/ProjectWorkspace.jsx');
    expect(src.split('\n').length).toBeLessThan(500);
    expect(src).not.toMatch(/from '\.\/(ProjectView|Wizard)\.jsx'/);
    expect(src).not.toMatch(/steps\//);
    for (const f of workspaceFiles()) expect(read(f), f).not.toMatch(/ProjectView|Wizard|onAdvanced|ws-advanced/);
  });

  it('exports go ONLY through lib/exportActions.js (the workspace is the only project screen)', () => {
    for (const f of ['src/components/ProjectWorkspace.jsx']) {
      const src = read(f);
      expect(src, f).toMatch(/exportActions\.js/);
      expect(src, f).not.toMatch(/createReportPdf|buildRenditionFile|shareOrDownload|freezeQuote|pdfToFile/);
    }
  });

  it('no #121212 anywhere in the workspace: the background is the app black', () => {
    for (const f of workspaceFiles()) expect(read(f), f).not.toMatch(/121212/);
    expect(read('src/components/ProjectWorkspace.jsx')).toMatch(/bg-black/);
  });

  it('the dropped "Editor avanzado" label is gone from every language', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[lang]['ws.advanced'], lang).toBeUndefined();
  });
});
