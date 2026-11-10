// @vitest-environment happy-dom
// Fase 11.4: the partida card, progressive disclosure. The definition (measures + waste) is one block, the logistics (materials, safety guide,
// machinery) lives in its own container; the waste slider is gone for a 3-pill selector (Minimum / Normal / Critical) built on WASTE_LIMITS.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import PartidaList from '../src/components/workspace/PartidaList.jsx';
import { newProject } from '../src/lib/projects.js';
import { computeAll } from '../src/lib/engine.js';
import { partidaGroups } from '../src/lib/workspaceModel.js';
import { WASTE_LIMITS, WASTE_PRESETS, TASKS } from '../src/lib/tasks.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de'];
const KEYS = ['fin.waste_min', 'fin.waste_normal', 'fin.waste_critical', 'ws.logistics'];

let host;
let root;
let updates;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);

const render = async ({ dims = { length: 6, width: 4 }, waste } = {}) => {
  const p = newProject({ regionCode: 'CL', name: 'Casa', client: 'Ana' });
  p.draft.mode = 'project';
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, ...dims };
  if (waste !== undefined) p.draft.partidas[0].waste = waste;
  const draft = p.draft;
  const result = computeAll(draft, Date.now(), { chains: false });
  const groups = partidaGroups(result, draft);
  updates = [];
  await act(async () => {
    root.render(
      React.createElement(
        I18nProvider,
        { lang: 'es', regionCode: 'CL' },
        React.createElement(PartidaList, {
          draft,
          groups,
          open: { [draft.partidas[0].id]: true },
          locked: false,
          onBlocked: () => {},
          onToggle: () => {},
          onUpdate: (id, fn) => updates.push(fn(draft.partidas.find((x) => x.id === id))),
          onTask: () => {},
          onAdd: () => {},
          onRemove: () => {},
          onPrice: () => {},
          showErrors: false,
          result,
          setDraft: () => {},
          projectLocation: null,
        }),
      ),
    );
  });
  return { draft, groups };
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('Fase 11.4: waste is a 3-pill selector, the slider is gone for good', () => {
  it('PercentSlider is neither imported nor used in PartidaList', () => {
    const src = readFileSync('src/components/workspace/PartidaList.jsx', 'utf8');
    expect(src).not.toContain('PercentSlider');
    expect(host.querySelector('input[type="range"]')).toBeNull();
  });

  it('three horizontal pills (Mínimo, Normal, Crítico) in one radiogroup; rounded-full, translucent, no outline or border', async () => {
    await render();
    const pills = ['min', 'normal', 'critical'].map((id) => q(`waste-0-${id}`));
    expect(pills.every(Boolean)).toBe(true);
    expect(pills.map((b) => b.textContent)).toEqual(['Mínimo5%', 'Normal15%', 'Crítico30%']); // the label carries its real figure
    const group = pills[0].parentElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.className).toContain('flex-row');
    expect(pills.every((b) => b.parentElement === group)).toBe(true);
    for (const b of pills) {
      expect(b.getAttribute('role')).toBe('radio');
      expect(b.className).toContain('rounded-full');
      expect(b.className).not.toMatch(/\bborder\b|\boutline\b|bg-neutral|bg-gray/); // OLED: colour is the only signal
      expect(b.className).toContain('active:scale-95');
    }
  });

  it('the values come from WASTE_PRESETS: Minimum is a REAL 5 % (never the 0 floor), Critical = max, Normal in between and inside the limits', async () => {
    await render();
    const read = async (id) => {
      updates.length = 0;
      await act(async () => {
        q(`waste-0-${id}`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      return updates[0].waste;
    };
    const lo = await read('min');
    const mid = await read('normal');
    const hi = await read('critical');
    expect(lo).toBe(5);
    expect(lo).toBe(WASTE_PRESETS.min);
    expect(lo).toBeGreaterThan(WASTE_LIMITS.min);
    expect(hi).toBe(WASTE_LIMITS.max);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
    expect(Number.isInteger((mid - WASTE_LIMITS.min) / WASTE_LIMITS.step)).toBe(true);
    expect([lo, mid, hi].every((v) => v > 0 && Number.isFinite(v))).toBe(true);
  });

  it('the active pill turns brand-coloured (aria-checked); a legacy / per-task value lights the NEAREST pill and nothing is rewritten', async () => {
    await render({ waste: WASTE_LIMITS.max });
    expect(q('waste-0-critical').getAttribute('aria-checked')).toBe('true');
    expect(q('waste-0-critical').className).toContain('bg-brand/20');
    expect(q('waste-0-min').getAttribute('aria-checked')).toBe('false');
    expect(q('waste-0-min').className).toContain('bg-white/5');
    expect(q('waste-0-value').textContent).toBe(`${WASTE_LIMITS.max}%`);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render({ waste: 7 }); // in-between value kept by an older build
    const on = ['min', 'normal', 'critical'].filter((id) => q(`waste-0-${id}`).getAttribute('aria-checked') === 'true');
    expect(on).toHaveLength(1);
    expect(q('waste-0-value').textContent).toBe('7%'); // the real figure stays visible
    expect(updates).toHaveLength(0);
  });

  it('a missing / NaN waste does not crash and shows the task default (never a silent 0 %)', async () => {
    const { draft } = await render({ waste: NaN });
    const def = TASKS[draft.partidas[0].task].defaultWaste;
    expect(def).toBeGreaterThan(0);
    expect(q('waste-0-value').textContent).toBe(`${def}%`);
    const on = ['min', 'normal', 'critical'].filter((id) => q(`waste-0-${id}`).getAttribute('aria-checked') === 'true');
    expect(on).toHaveLength(1); // the pill is the honest reading of the figure the quote uses
  });
});

describe('Fase 11.4: progressive disclosure inside the partida card', () => {
  it('the definition (measures + waste) and the logistics (materials, safety guide, machinery) are different containers', async () => {
    await render();
    const logistics = q('logistics-0');
    expect(logistics).not.toBeNull();
    expect(logistics.contains(q('materials-0'))).toBe(true);
    expect(logistics.contains(q('hse-row-0'))).toBe(true);
    expect(logistics.contains(q('waste-0'))).toBe(false); // the waste lives with the definition
    expect(logistics.contains(q('waste-0-min'))).toBe(false);
    expect(logistics.textContent).toContain(DICT.es['ws.logistics']);
    expect(q('waste-0').compareDocumentPosition(logistics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // definition first, logistics after
  });

  it('with no results yet (empty measures) the safety guide stays reachable, but no results header or material list is shown', async () => {
    await render({ dims: { length: 0, width: 0 } });
    expect(q('materials-0')).toBeNull();
    expect(q('hse-row-0')).not.toBeNull();
    expect(q('logistics-0').textContent).not.toContain(DICT.es['ws.logistics']);
  });
});

describe('Fase 11.4: the new words exist in the six languages', () => {
  it('every key is a non-empty string in every language, and the Spanish one is the reference', () => {
    for (const l of LANGS) for (const k of KEYS) expect(typeof DICT[l][k] === 'string' && DICT[l][k].trim().length > 0, `${l} ${k}`).toBe(true);
    expect(DICT.en['fin.waste_critical']).toBe('Critical');
    expect(DICT.it['fin.waste_normal']).toBe('Normale');
    expect(DICT.de['fin.waste_min']).toBe('Minimal');
    expect(DICT.fr['fin.waste_critical']).toBe('Critique');
  });
});
