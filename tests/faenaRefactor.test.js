// @vitest-environment happy-dom
// Refactor "Crear Proyecto / Configurar Faena": real waste figure, trash icon, task carousel, 12 trades, compact measures, accordions with chips.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import PartidaList from '../src/components/workspace/PartidaList.jsx';
import TaskPicker from '../src/components/TaskPicker.jsx';
import DimsForm, { headlineMetrics } from '../src/components/DimsForm.jsx';
import Collapsible from '../src/components/workspace/Collapsible.jsx';
import { newProject } from '../src/lib/projects.js';
import { computeAll } from '../src/lib/engine.js';
import { partidaGroups } from '../src/lib/workspaceModel.js';
import { TASKS, TASK_IDS, WASTE_PRESETS, WASTE_LIMITS, effectiveWaste, validateDims, runCalculation } from '../src/lib/tasks.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { CATALOG } from '../src/lib/catalog.js';
import { DICT } from '../src/lib/dict.js';
import { fieldLabel } from '../src/lib/reports.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const wrap = (el) => React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, el);
const draw = async (el) => act(async () => root.render(wrap(el)));

beforeEach(() => {
  resetRegistry();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('merma: Mínimo is a real 5 %, a missing value is never a silent 0 %', () => {
  it('presets are explicit and inside the limits', () => {
    expect(WASTE_PRESETS).toEqual({ min: 5, normal: 15, critical: 30 });
    for (const v of Object.values(WASTE_PRESETS)) expect(v).toBeGreaterThanOrEqual(WASTE_LIMITS.min);
  });
  it('effectiveWaste keeps real numbers (also numeric strings) and heals the rest with the task default', () => {
    expect(effectiveWaste(5, 'slab')).toBe(5);
    expect(effectiveWaste('5', 'slab')).toBe(5);
    expect(effectiveWaste(0, 'slab')).toBe(0); // an explicit 0 is a legitimate choice for the model
    for (const bad of [undefined, null, NaN, '', '   ', 'abc', Infinity, -3, 999]) expect(effectiveWaste(bad, 'paint')).toBe(TASKS.paint.defaultWaste);
    expect(effectiveWaste(NaN, 'ghost')).toBe(WASTE_PRESETS.min);
  });
  it('the engine prices with the healed figure: NaN waste = the task default, 5 stays 5', () => {
    const mk = (waste) => {
      const p = newProject({ regionCode: 'CL', name: 'Casa' });
      p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
      p.draft.partidas[0].waste = waste;
      return computeAll(p.draft, Date.now(), { chains: false }).partidas[0];
    };
    expect(mk(5).waste).toBe(5);
    expect(mk(NaN).waste).toBe(TASKS[mk(NaN).task].defaultWaste);
    expect(mk(undefined).waste).toBeGreaterThan(0);
  });
});

describe('twelve trades, each with a real calculator', () => {
  it('the catalogue has the 12 trades, each with a headline metric and 6 languages of names', () => {
    expect(TASK_IDS).toHaveLength(12);
    for (const id of ['excavation', 'pool', 'waterproofing', 'demolition', 'electrical', 'plumbing']) expect(TASK_IDS).toContain(id);
    for (const id of TASK_IDS) expect(TASKS[id].headline.length).toBeGreaterThan(0);
  });
  it('every trade produces finite metrics and lines that exist in the catalogue, from its defaults and a typical input', () => {
    const typical = { length: 5, width: 4, depth: 1.5, thickness: 15, outlets: 10, lights: 8, points: 6, run: 6 };
    for (const id of TASK_IDS) {
      const dims = {};
      for (const f of TASKS[id].fields) dims[f.key] = typical[f.key] ?? f.default ?? 1;
      const v = validateDims(id, dims);
      expect(v.valid, `${id} ${JSON.stringify(v.errors)}`).toBe(true);
      const r = runCalculation(id, v.values);
      for (const m of r.metrics) expect(Number.isFinite(m.value), `${id}.${m.key}`).toBe(true);
      for (const l of r.lines) {
        expect(CATALOG[l.id], `${id}:${l.id}`).toBeTruthy();
        expect(Number.isFinite(l.qty) && l.qty > 0, `${id}:${l.id}=${l.qty}`).toBe(true);
      }
    }
  });
  it('excavation: volume = L x W x D and the haul swells with the soil', () => {
    const v = (soil) => runCalculation('excavation', validateDims('excavation', { length: 4, width: 3, depth: 2, soil }).values);
    const m = (r, k) => r.metrics.find((x) => x.key === k).value;
    expect(m(v('medium'), 'earthVolume')).toBe(24);
    expect(m(v('soft'), 'haulVolume')).toBeCloseTo(27.6, 2);
    expect(m(v('hard'), 'haulVolume')).toBeCloseTo(33.6, 2);
  });
  it('empty / null / zero measures never reach the calculator (no NaN)', () => {
    for (const id of TASK_IDS) {
      for (const bad of ['', null, undefined, 'x']) {
        const dims = {};
        for (const f of TASKS[id].fields) if (f.required) dims[f.key] = bad;
        const v = validateDims(id, dims);
        expect(v.valid).toBe(false);
        expect(headlineMetrics(id, v)).toEqual([]);
      }
    }
  });
  it('electrical without points keeps the calculator quiet (no zero-qty lines)', () => {
    const v = validateDims('electrical', { outlets: 0, lights: 0, run: 6 });
    if (v.valid) expect(runCalculation('electrical', v.values).lines.every((l) => l.qty > 0)).toBe(true);
  });
  it('the three kinds of measure: area (m2), volume (m3) and points / linear metres', () => {
    expect(TASKS.excavation.headline).toContain('earthVolume');
    expect(TASKS.demolition.fields.some((f) => f.key === 'thickness')).toBe(true);
    expect(TASKS.electrical.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['outlets', 'lights', 'run']));
    expect(TASKS.plumbing.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['points', 'run']));
    expect(runCalculation('roof', validateDims('roof', { length: 8, width: 6, slope: 30 }).values).metrics.length).toBeGreaterThan(0);
  });
});

describe('every label the UI asks for resolves in the six languages (no raw keys on screen)', () => {
  it('task names, field labels, option labels and headline metrics', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const t = (k) => DICT[lang][k] ?? k;
      for (const id of TASK_IDS) {
        expect(t(`task.${id}`), `${lang} task.${id}`).not.toBe(`task.${id}`);
        for (const f of TASKS[id].fields) {
          const label = fieldLabel(t, id, f.key);
          expect(label, `${lang} ${id}.${f.key}`).not.toMatch(/^field\./);
        }
        for (const o of TASKS[id].options) {
          expect(t(`opt.${id}.${o.key}`), `${lang} opt.${id}.${o.key}`).not.toMatch(/^opt\./);
          for (const v of o.values ?? []) expect(t(`opt.${id}.${o.key}.${v}`), `${lang} ${id}.${o.key}.${v}`).not.toMatch(/^opt\./);
        }
        for (const m of TASKS[id].headline) expect(t(`metric.${m}`), `${lang} metric.${m}`).not.toMatch(/^metric\./);
      }
    }
  });
});

describe('TaskPicker: horizontal carousel', () => {
  it('one scrolling snap row, 12 cards, min width, centred wrapping text, nothing overflows', async () => {
    const picks = [];
    await draw(React.createElement(TaskPicker, { value: 'masonry', onChange: (id) => picks.push(id), labelledBy: 'x' }));
    const car = q('task-carousel');
    for (const c of ['flex', 'overflow-x-auto', 'snap-x', 'snap-mandatory', 'hide-scrollbar', 'space-x-4', 'py-4']) expect(car.className).toContain(c);
    const cards = TASK_IDS.map((id) => q(`task-${id}`));
    expect(cards.every(Boolean)).toBe(true);
    for (const b of cards) {
      for (const c of ['min-w-[140px]', 'snap-center', 'text-center', 'whitespace-normal', 'text-sm', 'leading-tight', 'active:scale-95']) expect(b.className).toContain(c);
      expect(b.className).not.toMatch(/\bborder\b|\boutline\b|bg-gray|bg-neutral/);
    }
    expect(q('task-masonry').getAttribute('aria-checked')).toBe('true');
    await act(async () => q('task-pool').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(picks).toEqual(['pool']);
  });
});

describe('DimsForm: compact grid and live result', () => {
  const partida = (task, dims) => ({ id: 'p', task, dims, waste: 5 });
  it('three measures on one row and the result appears with no calculate button', async () => {
    const dims = { length: 5, width: 4, depth: 2 };
    await draw(React.createElement(DimsForm, { partida: partida('excavation', dims), validation: validateDims('excavation', dims), showErrors: false, onChange: () => {} }));
    const grid = q('dims-grid');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('gap-2');
    expect(grid.querySelectorAll('input').length).toBeGreaterThanOrEqual(3);
    expect(q('dims-result').textContent).toMatch(/40/); // 5 x 4 x 2 m3
    expect(host.textContent.toLowerCase()).not.toContain('calcular');
    expect(host.querySelector('button[data-testid="calculate"]')).toBeNull();
  });
  it('an incomplete form shows no result at all (never NaN / half result)', async () => {
    const dims = { length: 5, width: '' };
    await draw(React.createElement(DimsForm, { partida: partida('excavation', dims), validation: validateDims('excavation', dims), showErrors: false, onChange: () => {} }));
    expect(host.textContent).not.toMatch(/NaN|Infinity/);
    expect(q('dims-result')?.textContent ?? '').toBe('');
  });
});

describe('Collapsible: one quiet row + chips', () => {
  it('closed it lists up to 4 chips and "+n"; opened the chips give way to the detail', async () => {
    await draw(React.createElement(Collapsible, { title: 'Materiales', chips: ['a', 'b', 'c', 'd', 'e', 'f'], testId: 'acc' }, React.createElement('p', { 'data-testid': 'inside' }, 'detalle')));
    const chips = q('acc-chips');
    expect(chips.querySelectorAll('li')).toHaveLength(5);
    expect(chips.textContent).toContain('+2');
    expect(q('acc').open).toBe(false);
    await act(async () => {
      q('acc').open = true;
      q('acc').dispatchEvent(new Event('toggle'));
    });
    expect(q('acc-chips')).toBeNull();
    expect(q('inside')).not.toBeNull();
  });
  it('no chips, no empty strip; the markup carries no borders', async () => {
    await draw(React.createElement(Collapsible, { title: 'Vacío', testId: 'acc2' }, 'x'));
    expect(q('acc2-chips')).toBeNull();
    expect(readFileSync('src/components/workspace/Collapsible.jsx', 'utf8')).not.toMatch(/\bborder\b|divide-/);
  });
});

describe('PartidaList: trash icon top-right, materials and machinery in accordions', () => {
  const render = async (onRemove = () => {}) => {
    const p = newProject({ regionCode: 'CL', name: 'Casa', client: 'Ana' });
    p.draft.mode = 'project';
    p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
    const draft = p.draft;
    const result = computeAll(draft, Date.now(), { chains: false });
    const groups = partidaGroups(result, draft);
    await draw(
      React.createElement(PartidaList, {
        draft, groups, open: { [draft.partidas[0].id]: true }, locked: false, onBlocked: () => {}, onToggle: () => {}, onUpdate: () => {},
        onTask: () => {}, onAdd: () => {}, onRemove, onPrice: () => {}, showErrors: false, result, setDraft: () => {}, projectLocation: null,
      }),
    );
    return draft;
  };
  it('delete is an icon button (no red text), top-right, with an accessible name, and still removes the partida', async () => {
    const removed = [];
    const draft = await render((id) => removed.push(id));
    const b = q('partida-remove-0');
    expect(b.querySelector('svg')).not.toBeNull();
    expect(b.textContent.trim()).toBe('');
    expect(b.getAttribute('aria-label')).toBeTruthy();
    expect(b.className).toContain('absolute');
    expect(b.className).toContain('right-0');
    expect(b.className).toContain('top-0');
    expect(b.className).not.toMatch(/text-red-\d+(?!\/)\b(?!\/)/);
    expect(b.className).toContain('active:scale-95');
    await act(async () => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(removed).toEqual([draft.partidas[0].id]);
  });
  it('materials fold into an accordion with one chip per material; the rows stay in the DOM', async () => {
    await render();
    const acc = q('materials-acc-0');
    expect(acc).not.toBeNull();
    expect(acc.open).toBe(false);
    expect(q('materials-acc-0-chips').querySelectorAll('li').length).toBeGreaterThan(0);
    expect(q('materials-0').className).not.toMatch(/\bborder\b|divide-/);
    expect(q('materials-0').querySelectorAll('li').length).toBeGreaterThan(0);
  });
});
