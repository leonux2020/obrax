// @vitest-environment happy-dom
// Phase 11: the Cronograma. The schedule leaves Squadra and becomes the sixth circle: a vertical timeline of phases whose earliest start and
// latest end ARE the project's dates (the ones the card of the main screen counts days with).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { newProject, normalizeProject, projectLevel, toDayString } from '../src/lib/projects.js';
import { PHASE_LIMIT, normalizePhases } from '../src/lib/ledger.js';
import { hasPhaseDates, phaseDates, phaseDaysLeft, phaseState, sortPhases, syncDates } from '../src/lib/phases.js';
import { withPhaseAdded, withPhaseEdited, withoutPhase } from '../src/lib/workspaceModel.js';
import { freezeQuote } from '../src/lib/signature.js';
import { mergeProject, stampProject } from '../src/lib/merge.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};
const ph = (id, name, startDate = '', endDate = '', done = false) => ({ id, name, startDate, endDate, done });
const base = (extra = {}) => ({ ...newProject({ regionCode: 'CL', name: 'Casa', client: 'Ana' }), ...extra });

// ---- the pure rules --------------------------------------------------------------------------------------------------------------
describe('phases: normalization', () => {
  it('keeps what is valid and cleans the rest', () => {
    const out = normalizePhases([
      { id: 'ab12', name: 'Fundaciones', startDate: '2026-03-01', endDate: '2026-03-10', done: true },
      { id: 'ab12', name: 'Duplicado id', startDate: 'mañana', endDate: 'pronto' }, // junk dates, same id
      { name: 'Techo', startDate: '2026-04-10', endDate: '2026-04-01' }, // end before start: the end is dropped
      { name: '<b>x</b>'.repeat(30) },
      null,
      7,
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ id: 'ab12', name: 'Fundaciones', startDate: '2026-03-01', endDate: '2026-03-10', done: true });
    expect(out[1].id).not.toBe('ab12'); // ids are unique
    expect(out[1]).toMatchObject({ startDate: '', endDate: '', done: false });
    expect(out[2]).toMatchObject({ startDate: '2026-04-10', endDate: '' });
    expect(out[3].name.length).toBeLessThanOrEqual(60);
    expect(normalizePhases('nope')).toEqual([]);
    expect(normalizePhases(Array.from({ length: PHASE_LIMIT + 10 }, (_, i) => ({ name: `F${i}` })))).toHaveLength(PHASE_LIMIT);
  });
  it('a name keeps its spaces while it is being typed and may be empty; updatedAt survives', () => {
    expect(normalizePhases([{ name: 'Obra ', updatedAt: 123 }])[0]).toMatchObject({ name: 'Obra ', updatedAt: 123 });
    expect(normalizePhases([{ name: '' }])[0].name).toBe('');
  });
  it('new projects start with no phases; older records load with none', () => {
    expect(newProject({ regionCode: 'CL' }).phases).toEqual([]);
    const { phases, ...old } = base();
    expect(normalizeProject(old).phases).toEqual([]);
  });
});

describe('phases: the project dates are DERIVED (earliest start, latest end)', () => {
  it('phaseDates: every phase counts, finished or not; a start-only phase ends where it starts; nothing dated gives nothing', () => {
    expect(phaseDates([ph('phaaa', 'A', '2026-03-05', '2026-03-09', true), ph('phbbb', 'B', '2026-03-01', '2026-03-03'), ph('phccc', 'C', '2026-03-20', '2026-04-02')])).toEqual({ startDate: '2026-03-01', endDate: '2026-04-02' });
    expect(phaseDates([ph('phaaa', 'A', '2026-03-05'), ph('phbbb', 'B', '2026-03-01', '2026-03-03')])).toEqual({ startDate: '2026-03-01', endDate: '2026-03-05' });
    expect(phaseDates([ph('phaaa', 'A'), ph('phbbb', 'B')])).toEqual({ startDate: '', endDate: '' });
    expect(phaseDates(undefined)).toEqual({ startDate: '', endDate: '' });
    expect(hasPhaseDates([ph('phaaa', 'A')])).toBe(false);
    expect(hasPhaseDates([ph('phaaa', 'A', '2026-03-05')])).toBe(true);
  });
  it('syncDates: the phases win; without dated phases the typed dates stay; same object when nothing moves', () => {
    const p = base({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(syncDates(p)).toBe(p);
    const q = { ...p, phases: [ph('phaaa', 'A', '2026-03-01', '2026-03-10'), ph('phbbb', 'B', '2026-03-12', '2026-04-02')] };
    expect(syncDates(q)).toMatchObject({ startDate: '2026-03-01', endDate: '2026-04-02' });
    const same = { ...q, startDate: '2026-03-01', endDate: '2026-04-02' };
    expect(syncDates(same)).toBe(same);
    expect(syncDates({ ...p, phases: [ph('phaaa', 'A', '', '2026-05-01')] })).toMatchObject({ startDate: '2026-01-01', endDate: '2026-05-01' }); // a date the phases cannot give stays
    expect(syncDates({ ...p, phases: [ph('phaaa', 'A', '2026-09-01')] })).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-01' }); // start-only: it ends where it starts
  });
  it('loading a stored project (or merging devices) re-derives the dates: they can never disagree with the phases', () => {
    const stored = { ...base({ startDate: '2020-01-01', endDate: '2020-01-02' }), phases: [ph('phaaa', 'A', '2026-03-01', '2026-03-10'), ph('phbbb', 'B', '2026-03-05', '2026-03-31')] };
    expect(normalizeProject(stored)).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31' });
    const a = { ...stored, updatedAt: 10, phases: [{ ...stored.phases[0], updatedAt: 10 }] };
    const b = { ...stored, updatedAt: 20, phases: [{ ...stored.phases[1], updatedAt: 20 }] };
    const merged = mergeProject(a, b);
    expect(merged.phases.map((x) => x.id).sort()).toEqual(['phaaa', 'phbbb']); // both devices' phases survive
    expect(merged).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(mergeProject(b, a)).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31' }); // symmetric
  });
  it('a phased project reads the same level / days on the card as one with those dates typed by hand', () => {
    const typed = base({ startDate: day(-3), endDate: day(10) });
    const phased = syncDates({ ...base({ startDate: '', endDate: '' }), phases: [ph('phaaa', 'A', day(-3), day(2)), ph('phbbb', 'B', day(3), day(10))] });
    expect(phased.startDate).toBe(day(-3));
    expect(phased.endDate).toBe(day(10));
    expect(projectLevel(phased, Date.now())).toEqual(projectLevel(typed, Date.now()));
  });
  it('stampProject: a new / edited phase gets its updatedAt, a deleted one a tombstone (so another device does not bring it back)', () => {
    const p0 = base();
    const p1 = withPhaseAdded(p0, { id: 'php01', name: 'Obra gruesa' });
    const s1 = stampProject(p0, p1, 500);
    expect(s1.phases[0].updatedAt).toBe(500);
    const s2 = stampProject(s1, withoutPhase(s1, 'php01'), 900);
    expect(s2.phases).toEqual([]);
    expect(s2.tomb.php01).toBe(900);
  });
});

describe('phases: state, days left, order', () => {
  const now = new Date(2026, 5, 15, 13, 30).getTime();
  it('done / active / pending', () => {
    expect(phaseState(ph('phaaa', 'A', '2026-06-01', '2026-06-30', true), now)).toBe('done');
    expect(phaseState(ph('phaaa', 'A', '2026-06-01', '2026-06-30'), now)).toBe('active');
    expect(phaseState(ph('phaaa', 'A', '2026-06-15', '2026-06-30'), now)).toBe('active'); // starts today
    expect(phaseState(ph('phaaa', 'A', '2026-06-16', '2026-06-30'), now)).toBe('pending');
    expect(phaseState(ph('phaaa', 'A'), now)).toBe('pending'); // no dates: not started
    expect(phaseState(ph('phaaa', 'A', '2026-01-01', '2026-02-01'), now)).toBe('active'); // overdue and not done: still in progress
  });
  it('days left: positive, today, overdue, none', () => {
    expect(phaseDaysLeft(ph('phaaa', 'A', '', '2026-06-18'), now)).toBe(3);
    expect(phaseDaysLeft(ph('phaaa', 'A', '', '2026-06-15'), now)).toBe(0);
    expect(phaseDaysLeft(ph('phaaa', 'A', '', '2026-06-13'), now)).toBe(-2);
    expect(phaseDaysLeft(ph('phaaa', 'A'), now)).toBeNull();
  });
  it('sortPhases: chronological, undated last, typed order for ties', () => {
    const list = [ph('phuuu', 'Sin fecha'), ph('phccc', 'C', '2026-03-20'), ph('phaaa', 'A', '2026-03-01', '2026-03-09'), ph('phbbb', 'B', '2026-03-01', '2026-03-05'), ph('phvvv', 'Otra sin fecha')];
    expect(sortPhases(list).map((x) => x.id)).toEqual(['phbbb', 'phaaa', 'phccc', 'phuuu', 'phvvv']);
  });
});

describe('phases: editing rules', () => {
  it('add / edit / remove keep the project dates in step', () => {
    let p = base({ startDate: '', endDate: '' });
    p = withPhaseAdded(p, { id: 'phaaa', name: 'Excavación' });
    expect(p.phases).toHaveLength(1);
    expect(p.startDate).toBe(''); // no dates yet: nothing to derive
    p = withPhaseEdited(p, 'phaaa', { startDate: '2026-03-01', endDate: '2026-03-10' });
    expect(p).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-10' });
    p = withPhaseAdded(p, { id: 'phbbb', name: 'Estructura' });
    p = withPhaseEdited(p, 'phbbb', { startDate: '2026-03-11', endDate: '2026-04-20' });
    expect(p).toMatchObject({ startDate: '2026-03-01', endDate: '2026-04-20' });
    p = withoutPhase(p, 'phbbb');
    expect(p).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-10' });
    p = withoutPhase(p, 'phaaa'); // nothing dated left: the last dates stay (they were the job's dates)
    expect(p.phases).toEqual([]);
    expect(p).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-10' });
  });
  it('a start past the end drags the end; an end before the start and junk are refused; nothing changes = the SAME project', () => {
    let p = withPhaseAdded(base(), { id: 'phaaa', name: 'A' });
    p = withPhaseEdited(p, 'phaaa', { startDate: '2026-03-01', endDate: '2026-03-10' });
    expect(withPhaseEdited(p, 'phaaa', { startDate: '2026-03-20' }).phases[0]).toMatchObject({ startDate: '2026-03-20', endDate: '2026-03-20' });
    expect(withPhaseEdited(p, 'phaaa', { endDate: '2026-02-01' })).toBe(p);
    expect(withPhaseEdited(p, 'phaaa', { endDate: 'ayer' })).toBe(p);
    expect(withPhaseEdited(p, 'phaaa', { endDate: '2026-03-10' })).toBe(p);
    expect(withPhaseEdited(p, 'zzz', { name: 'x' })).toBe(p);
    expect(withPhaseEdited(p, 'phaaa', { endDate: '' }).phases[0].endDate).toBe('');
    expect(withPhaseEdited(p, 'phaaa', { name: 'Nuevo nombre', done: true }).phases[0]).toMatchObject({ name: 'Nuevo nombre', done: true });
  });
  it('the list is capped', () => {
    let p = base();
    for (let i = 0; i < PHASE_LIMIT + 3; i += 1) p = withPhaseAdded(p, { name: `F${i}` });
    expect(p.phases).toHaveLength(PHASE_LIMIT);
  });
  it('LOCKED quote: dates (and removing a dated phase) are refused because they set the machinery days; name and "completed" stay operational', () => {
    let p = withPhaseAdded(base(), { id: 'phaaa', name: 'A' });
    p = withPhaseEdited(p, 'phaaa', { startDate: '2026-03-01', endDate: '2026-03-10' });
    p = withPhaseAdded(p, { id: 'phuuu', name: 'Sin fechas' });
    const locked = { ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) };
    expect(withPhaseEdited(locked, 'phaaa', { startDate: '2026-03-05' })).toBe(locked);
    expect(withoutPhase(locked, 'phaaa')).toBe(locked);
    expect(withPhaseEdited(locked, 'phaaa', { name: 'Renombrada' }).phases[0].name).toBe('Renombrada');
    expect(withPhaseEdited(locked, 'phaaa', { done: true }).phases[0].done).toBe(true);
    expect(withoutPhase(locked, 'phuuu').phases).toHaveLength(1); // no dates: removing it moves nothing
    expect(withPhaseAdded(locked, { id: 'phnnn', name: 'Nueva' }).phases).toHaveLength(3);
  });
});

// ---- the screen ----------------------------------------------------------------------------------------------------------------
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
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} }),
    React.createElement(ToastHost)
  );
}
const mount = async (extra = {}, lang = 'es') => {
  spy = {};
  const project = syncDates({ ...base({ startDate: '', endDate: '' }), ...extra });
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(Harness, { initial: project })));
  });
  await flush();
};
const openTimeline = async () => click(q('ws-timeline'));

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('the sixth circle', () => {
  it('"Cronograma" is the sixth tile of the grid, a clean calendar icon in the same circle as the others; its sheet is the vertical timeline', async () => {
    await mount();
    const grid = q('ws-menu');
    expect(grid.children).toHaveLength(6);
    expect(grid.lastElementChild).toBe(q('ws-timeline'));
    expect(q('ws-timeline').textContent).toContain('Cronograma');
    const icon = q('ws-timeline-circle').querySelector('svg[data-outline-icon="true"][data-icon="calendar"]');
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('width')).toBe('32');
    expect(q('ws-timeline-circle').className).toContain('rounded-full');
    expect(q('ws-timeline').querySelector('[class*="text-neutral-500"]')).toBeNull(); // no figure while there are no phases
    await openTimeline();
    expect(q('ws-timeline-sheet')).not.toBeNull();
    expect(q('timeline-empty').textContent).toBe(DICT.es['tl.empty']);
    expect(q('timeline-span')).toBeNull(); // no dates yet
    expect(q('phase-add').textContent).toBe('+ Añadir fase');
  });

  it('every language names it', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of ['ws.menu.timeline', 'ws.tl.title', 'tl.untitled', 'tl.nodates', 'tl.name', 'tl.markDone', 'tl.reopen', 'tl.add', 'tl.empty', 'tl.leftN', 'tl.left1', 'tl.leftToday', 'tl.late', 'tl.defaultName', 'proj.datesDerived']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
    expect(DICT.it['ws.menu.timeline']).toBe('Cronoprogramma');
  });
});

describe('the vertical timeline', () => {
  const three = () => ({
    phases: [
      ph('pend00', 'Terminaciones', day(5), day(12)),
      ph('fin000', 'Fundaciones', day(-20), day(-10), true),
      ph('act000', 'Estructura', day(-3), day(4)),
    ],
  });

  it('a continuous line on the left (border-l-2 border-neutral-800), the phases in chronological order, one node each', async () => {
    await mount(three());
    await openTimeline();
    const list = q('timeline-list');
    expect(list.tagName).toBe('OL');
    for (const cls of ['border-l-2', 'border-neutral-800']) expect(list.className).toContain(cls);
    expect([...list.children].map((li) => li.dataset.testid)).toEqual(['phase-fin000', 'phase-act000', 'phase-pend00']);
    expect(host.querySelector('[data-testid="ws-timeline-sheet"] [class*="overflow-x"]')).toBeNull(); // no horizontal scroll: this is not a Gantt
    for (const id of ['fin000', 'act000', 'pend00']) expect(q(`phase-node-${id}`).className).toContain('rounded-full');
  });

  it('COMPLETED: a node with a check and dim text', async () => {
    await mount(three());
    await openTimeline();
    expect(q('phase-fin000').dataset.state).toBe('done');
    expect(q('phase-node-fin000').querySelector('svg[data-icon="check"]')).not.toBeNull();
    expect(q('phase-name-fin000').className).toContain('text-neutral-500');
    expect(q('phase-left-fin000')).toBeNull();
  });

  it('IN PROGRESS: a node lit in the primary colour, bright text and "X días restantes"', async () => {
    await mount(three());
    await openTimeline();
    expect(q('phase-act000').dataset.state).toBe('active');
    expect(q('phase-node-act000').className).toContain('bg-brand');
    for (const cls of ['text-neutral-100', 'font-medium']) expect(q('phase-name-act000').className).toContain(cls);
    expect(q('phase-left-act000').textContent).toBe('4 días restantes');
    expect(q('phase-left-act000').dataset.days).toBe('4');
    expect(q('phase-node-act000').querySelector('svg')).toBeNull();
  });

  it('PENDING: an empty node with a neutral-600 border and text-neutral-500', async () => {
    await mount(three());
    await openTimeline();
    expect(q('phase-pend00').dataset.state).toBe('pending');
    expect(q('phase-node-pend00').className).toContain('border border-neutral-600');
    expect(q('phase-node-pend00').className).not.toContain('bg-brand');
    expect(q('phase-name-pend00').className).toContain('text-neutral-500');
    expect(q('phase-left-pend00')).toBeNull();
  });

  it('the days-left text speaks every case: 1 day, today, overdue', async () => {
    await mount({ phases: [ph('phaaa', 'Una', day(-2), day(1)), ph('phbbb', 'Hoy', day(-2), day(0)), ph('phccc', 'Tarde', day(-9), day(-3))] });
    await openTimeline();
    expect(q('phase-left-phaaa').textContent).toBe('1 día restante');
    expect(q('phase-left-phbbb').textContent).toBe('Termina hoy');
    expect(q('phase-left-phccc').textContent).toBe('3 días de retraso');
    expect(q('phase-left-phccc').className).not.toContain('text-brand'); // overdue is amber, not the calm primary
  });

  it('the project span is shown under the title and is the earliest start to the latest end', async () => {
    await mount(three());
    await openTimeline();
    expect(spy.project.startDate).toBe(day(-20));
    expect(spy.project.endDate).toBe(day(12));
    expect(q('timeline-span').dataset.days).toBe('32');
    expect(q('timeline-span').textContent).toContain('32 días');
  });

  it('the tile shows how many phases are completed', async () => {
    await mount(three());
    expect(q('ws-timeline').textContent).toContain('1/3');
  });
});

describe('the passive accordion (no modals)', () => {
  const two = () => ({ phases: [ph('phaaa', 'Excavación', day(-3), day(2)), ph('phbbb', 'Hormigón', day(3), day(9))] });

  it('tapping a phase unfolds name, start and end with NATIVE date pickers; one phase at a time; no sheet on top', async () => {
    await mount(two());
    await openTimeline();
    expect(q('phase-panel-phaaa')).toBeNull();
    await click(q('phase-toggle-phaaa'));
    expect(q('phase-toggle-phaaa').getAttribute('aria-expanded')).toBe('true');
    expect(q('phase-panel-phaaa').className).toContain('acc-open');
    expect(q('phase-input-phaaa').value).toBe('Excavación');
    expect(q('phase-start-phaaa').type).toBe('date');
    expect(q('phase-end-phaaa').type).toBe('date');
    expect(q('phase-start-phaaa').value).toBe(day(-3));
    expect(qa('sheet-backdrop')).toHaveLength(1); // the timeline sheet only
    await click(q('phase-toggle-phbbb'));
    expect(q('phase-panel-phaaa')).toBeNull();
    expect(q('phase-panel-phbbb')).not.toBeNull();
    await click(q('phase-toggle-phbbb'));
    expect(q('phase-panel-phbbb')).toBeNull();
  });

  it('editing a phase moves the PROJECT dates (the ones the card counts days with)', async () => {
    await mount(two());
    await openTimeline();
    expect(spy.project).toMatchObject({ startDate: day(-3), endDate: day(9) });
    await click(q('phase-toggle-phbbb'));
    await typeInto(q('phase-end-phbbb'), day(30));
    expect(spy.project.endDate).toBe(day(30));
    await typeInto(q('phase-start-phbbb'), day(-10)); // the earliest start now belongs to the second phase
    expect(spy.project.startDate).toBe(day(-10));
    expect(q('timeline-span').dataset.days).toBe('40');
    await typeInto(q('phase-end-phbbb'), day(-20)); // an end before the start is refused
    expect(spy.project.phases.find((x) => x.id === 'phbbb').endDate).toBe(day(30));
  });

  it('the name is typed as written (spaces included) and an empty one reads "Fase sin nombre"', async () => {
    await mount(two());
    await openTimeline();
    await click(q('phase-toggle-phaaa'));
    await typeInto(q('phase-input-phaaa'), 'Obra gruesa ');
    expect(spy.project.phases[0].name).toBe('Obra gruesa ');
    expect(q('phase-name-phaaa').textContent).toBe('Obra gruesa');
    await typeInto(q('phase-input-phaaa'), '');
    expect(q('phase-name-phaaa').textContent).toBe('Fase sin nombre');
  });

  it('"Marcar como completada" turns the node into a check (dim) and the label into "Reabrir fase"; the span does not shrink', async () => {
    await mount(two());
    await openTimeline();
    await click(q('phase-toggle-phaaa'));
    expect(q('phase-done-phaaa').textContent).toBe('Marcar como completada');
    await click(q('phase-done-phaaa'));
    expect(spy.project.phases[0].done).toBe(true);
    expect(q('phase-phaaa').dataset.state).toBe('done');
    expect(q('phase-node-phaaa').querySelector('svg[data-icon="check"]')).not.toBeNull();
    expect(q('phase-done-phaaa').textContent).toBe('Reabrir fase');
    expect(spy.project.startDate).toBe(day(-3)); // a finished phase is still part of the job's span
    await click(q('phase-done-phaaa'));
    expect(q('phase-phaaa').dataset.state).toBe('active');
    expect(q('ws-timeline').textContent).toContain('0/2');
  });

  it('"+ Añadir fase" at the end of the list adds a phase and opens it, ready to name and date', async () => {
    await mount(two());
    await openTimeline();
    const add = q('phase-add');
    expect(q('timeline-list').compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(add);
    expect(spy.project.phases).toHaveLength(3);
    const created = spy.project.phases[2];
    expect(created.name).toBe('Fase 3');
    expect(q(`phase-panel-${created.id}`)).not.toBeNull();
    expect(q(`phase-input-${created.id}`).value).toBe('Fase 3');
    expect(q('phase-phaaa').compareDocumentPosition(q(`phase-${created.id}`)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // undated: last
    await typeInto(q(`phase-start-${created.id}`), day(20));
    expect(q('timeline-list').lastElementChild.dataset.testid).toBe(`phase-${created.id}`);
    expect(spy.project.endDate).toBe(day(20));
  });

  it('deleting is two taps (trash, then confirm) and the dates fall back to the remaining phases', async () => {
    await mount(two());
    await openTimeline();
    await click(q('phase-toggle-phbbb'));
    await click(q('phase-del-phbbb'));
    expect(spy.project.phases).toHaveLength(2); // one tap deletes nothing
    await click(q('phase-del-phbbb-confirm'));
    expect(spy.project.phases.map((x) => x.id)).toEqual(['phaaa']);
    expect(spy.project.endDate).toBe(day(2));
    expect(q('phase-panel-phbbb')).toBeNull();
  });

  it('with a LOCKED quote the dates sit behind the shield ("Precios bloqueados") while name and "completed" keep working', async () => {
    const p = { ...base({ startDate: '', endDate: '' }), ...two() };
    const locked = { ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) };
    await mount(locked);
    await openTimeline();
    await click(q('phase-toggle-phaaa'));
    expect(q('phase-start-phaaa').closest('fieldset').disabled).toBe(true);
    expect(q('phase-end-phaaa').closest('fieldset').disabled).toBe(true);
    const shield = q('phase-panel-phaaa').querySelector('[data-testid="locked-shield"]');
    const before = spy.project;
    await click(shield);
    expect(q('toast').textContent).toBe('Precios bloqueados');
    expect(spy.project.phases).toBe(before.phases);
    expect(q('phase-input-phaaa').closest('fieldset')).toBeNull();
    await typeInto(q('phase-input-phaaa'), 'Renombrada');
    expect(spy.project.phases[0].name).toBe('Renombrada');
    await click(q('phase-done-phaaa'));
    expect(spy.project.phases[0].done).toBe(true);
  });

  it('works in every language', async () => {
    for (const lang of ['en', 'pt', 'fr', 'it', 'de']) {
      await mount(two(), lang);
      await openTimeline();
      expect(q('phase-add').textContent).toBe(`+ ${DICT[lang]['tl.add']}`);
      expect(q('phase-left-phaaa').textContent).toBe(DICT[lang]['tl.leftN'].replace('{n}', '2'));
      act(() => root.unmount());
      root = createRoot(host);
    }
  });
});

describe('Squadra and the project sheet after the split', () => {
  it('the project sheet shows the derived dates read-only once the Cronograma has dates, and the two date fields while it has none', async () => {
    const open = (project) => act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ProjectSheet, { project, onSave: () => {}, onClose: () => {}, onDelete: () => {} }))));
    await open(base({ startDate: day(-2), endDate: day(5) }));
    expect(q('project-dates-derived')).toBeNull();
    expect(host.querySelectorAll('input[type="date"]').length).toBeGreaterThanOrEqual(2);
    act(() => root.unmount());
    root = createRoot(host);
    await open(syncDates({ ...base({ startDate: day(-2), endDate: day(5) }), phases: [ph('phaaa', 'A', day(-10), day(20))] }));
    expect(q('project-dates-derived').textContent).toContain(day(-10));
    expect(q('project-dates-derived').textContent).toContain(day(20));
    expect(q('project-dates-derived').textContent).toContain('calculadas desde el Cronograma');
    expect(host.querySelector('input[type="date"]')).toBeNull();
  });
});
