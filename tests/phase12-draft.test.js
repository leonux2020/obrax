// @vitest-environment happy-dom
// "Nuevo proyecto" opens the project screen itself as a DRAFT / SIMULATION: no isolated form, nothing in the database until GUARDAR.
import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import App from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { FREE_PROJECT_LIMIT } from '../src/lib/pro.js';
import { DICT } from '../src/lib/dict.js';
import { resetToasts } from '../src/lib/notify.js';
import { q, flush, click, createHost, createProjectViaDraft, saveDraftAs, deviceBack } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let h;

const setNative = async (el, value) => {
  await act(async () => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const stored = async () => projectStore.load();
const figure = () => q('ws-due').textContent.replace(/\s/g, ' ');

beforeEach(async () => {
  localStorage.clear();
  resetToasts();
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  h = createHost(App);
  await h.mount();
});
afterEach(() => {
  h?.unmount();
  localStorage.clear();
});

describe('the draft screen (Borrador / Simulación)', () => {
  it('"Nuevo proyecto" goes straight to the project screen: no form, an invisible name field, 0 (Simulación), the grid active and the draft bar instead of the dock', async () => {
    await click(q('fab-new'));
    expect(q('new-form')).toBeNull();
    expect(q('project-workspace')).not.toBeNull();
    const name = q('ws-draft-name');
    expect(name.tagName).toBe('INPUT');
    expect(name.placeholder).toBe('Toca para añadir nombre');
    expect(name.value).toBe('');
    expect(name.className).toContain('bg-transparent');
    expect(name.className).not.toMatch(/\bborder/);
    expect(q('ws-sim-label').textContent).toBe('(Simulación)');
    expect(figure()).toMatch(/\$\s?0\b/); // starts at 0
    expect(q('ws-menu')).not.toBeNull();
    for (const id of ['crew', 'finance', 'cash', 'log', 'expenses', 'timeline']) expect(q(`ws-${id}`), id).not.toBeNull(); // the 6 buttons of the grid
    expect(q('draft-bar')).not.toBeNull();
    expect(q('ws-zone-c')).toBeNull(); // the standard dock (Diario, Foto...) is hidden
    expect(q('dock-camera')).toBeNull();
    expect(q('draft-simulate')).not.toBeNull();
    expect(q('draft-save')).not.toBeNull();
  });

  it('the draft lives only in memory: nothing is written until GUARDAR', async () => {
    await click(q('fab-new'));
    await setNative(q('ws-draft-name'), 'Casa Norte');
    await click(q('draft-simulate'));
    await flush(400);
    expect(await stored()).toHaveLength(0);
  });

  it('SIMULAR / CALCULAR refreshes the big figure from what was typed, without saving; a later change shows the "toca Simular" hint', async () => {
    await click(q('fab-new'));
    await click(q('ws-edit')); // the details: "Llave en mano" = one global line to measure
    await click(q('budget-turnkey'));
    await click(q('project-save'));
    expect(q('draft-bar')).not.toBeNull(); // still a draft: the details sheet only edits it
    const before = figure();
    expect(q('ws-sim-stale')).toBeNull();
    // the measures of the first partida: its numeric fields open the on-screen pad
    const typeDims = async (digit) => {
      const fields = [...q('partida-0').querySelectorAll('input[readonly]')].slice(0, 2); // length and width
      for (const f of fields) {
        await click(f);
        await click(q(`pad-${digit}`));
        await click(q('pad-done'));
      }
    };
    await typeDims('5');
    expect(q('ws-sim-stale')).toBeNull(); // nothing was simulated yet: the figure is still the 0 snapshot
    expect(figure()).toBe(before);
    await click(q('draft-simulate'));
    expect(q('ws-sim-label')).not.toBeNull(); // still a simulation
    const shown = figure();
    expect(shown).not.toBe(before); // the big number now shows what the measures cost
    expect(q('ws-sim-stale')).toBeNull();
    // change what was typed afterwards -> the snapshot is old until the next SIMULAR
    await typeDims('9');
    expect(figure()).toBe(shown);
    expect(q('ws-sim-stale')).not.toBeNull();
    await click(q('draft-simulate'));
    expect(q('ws-sim-stale')).toBeNull();
    expect(figure()).not.toBe(shown);
    expect(await stored()).toHaveLength(0);
  });

  it('GUARDAR with no name asks for one in a soft sheet; with it the project is stored and the UI turns normal (dock back, no simulation label)', async () => {
    await click(q('fab-new'));
    await click(q('draft-save'));
    expect(q('draft-name-sheet')).not.toBeNull();
    expect(q('draft-name-confirm').disabled).toBe(true); // an empty name never passes
    expect(await stored()).toHaveLength(0);
    await setNative(q('draft-name-input'), '   ');
    expect(q('draft-name-confirm').disabled).toBe(true);
    await setNative(q('draft-name-input'), 'Casa Sur');
    await click(q('draft-name-confirm'));
    await flush(400);
    expect(q('draft-name-sheet')).toBeNull();
    expect(q('draft-bar')).toBeNull();
    expect(q('ws-sim-label')).toBeNull();
    expect(q('ws-draft-name')).toBeNull();
    expect(q('ws-title').textContent).toBe('Casa Sur');
    expect(q('ws-zone-c')).not.toBeNull(); // the standard dock is back
    const [saved] = await stored();
    expect(saved.draft.project.name).toBe('Casa Sur');
  });

  it('with the name already typed in the header GUARDAR saves at once (no sheet) and the project shows in the Dashboard', async () => {
    await click(q('fab-new'));
    await setNative(q('ws-draft-name'), 'Casa Este');
    await click(q('draft-save'));
    await flush(400);
    expect(q('draft-name-sheet')).toBeNull();
    expect((await stored()).map((p) => p.draft.project.name)).toEqual(['Casa Este']);
    expect(q('ws-title').textContent).toBe('Casa Este');
    await deviceBack();
    expect(q('project-workspace')).toBeNull();
    expect(h.host.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
  });
});

describe('leaving a draft', () => {
  it('Back on an untouched draft leaves silently: nothing was saved', async () => {
    await click(q('fab-new'));
    await deviceBack();
    expect(q('project-workspace')).toBeNull();
    expect(q('draft-leave-sheet')).toBeNull();
    expect(await stored()).toHaveLength(0);
    expect(q('fab-new')).not.toBeNull();
  });

  it('Back on a draft with data asks first: "Seguir editando" stays, "Descartar" leaves with nothing in the database, "Guardar" saves', async () => {
    await click(q('fab-new'));
    await setNative(q('ws-draft-name'), 'Casa Oeste');
    await deviceBack();
    expect(q('draft-leave-sheet')).not.toBeNull();
    expect(q('project-workspace')).not.toBeNull();
    await click(q('draft-leave-keep'));
    expect(q('draft-leave-sheet')).toBeNull();
    expect(q('ws-draft-name').value).toBe('Casa Oeste');
    expect(await stored()).toHaveLength(0);
    // the Back entry is armed again: a second Back asks again
    await deviceBack();
    expect(q('draft-leave-sheet')).not.toBeNull();
    await click(q('draft-leave-discard'));
    await flush(60);
    expect(q('project-workspace')).toBeNull();
    expect(await stored()).toHaveLength(0);
    expect(q('fab-new')).not.toBeNull();
    // and saving from the same question works
    await click(q('fab-new'));
    await setNative(q('ws-draft-name'), 'Casa Oeste');
    await deviceBack();
    await click(q('draft-leave-save'));
    await flush(400);
    expect((await stored()).map((p) => p.draft.project.name)).toEqual(['Casa Oeste']);
  });
});

describe('what did not change', () => {
  it('existing projects open exactly as before: the dock, the real figure, no draft bar, no simulation label', async () => {
    await createProjectViaDraft('Obra vieja');
    await deviceBack();
    await click(q('project-card'));
    expect(q('project-workspace')).not.toBeNull();
    expect(q('draft-bar')).toBeNull();
    expect(q('ws-sim-label')).toBeNull();
    expect(q('ws-draft-name')).toBeNull();
    expect(q('ws-title').textContent).toBe('Obra vieja');
    expect(q('ws-edit')).not.toBeNull();
    expect(q('ws-zone-c')).not.toBeNull(); // the standard dock
  });

  it('a second draft is independent of the first project and of a discarded draft', async () => {
    await createProjectViaDraft('Uno');
    await deviceBack();
    await click(q('fab-new'));
    expect(q('ws-draft-name').value).toBe('');
    await saveDraftAs('Dos');
    expect((await stored()).map((p) => p.draft.project.name).sort()).toEqual(['Dos', 'Uno']);
  });

  it('the free plan limit still blocks the 4th project with the paywall (no draft opens)', async () => {
    for (let i = 1; i <= FREE_PROJECT_LIMIT; i += 1) {
      expect(await createProjectViaDraft(`Obra ${i}`)).toBe(true);
      await deviceBack();
    }
    await click(q('fab-new'));
    expect(q('pro-paywall')).not.toBeNull();
    expect(q('draft-bar')).toBeNull();
  });
});

describe('source + words', () => {
  const read = (f) => readFileSync(f, 'utf8');
  it('the draft UI keeps the OLED contract: no borders / outlines / grey backgrounds in the new bar', () => {
    const src = read('src/components/workspace/DraftBar.jsx');
    expect(src).not.toMatch(/\bborder|outline-|bg-(neutral|gray|zinc|slate|stone)-\d/);
    expect(src).toContain('active:scale-95');
  });
  it('the draft words exist in the six languages and are really translated', () => {
    const keys = ['ws.draft.namePh', 'ws.sim.label', 'ws.sim.stale', 'ws.draft.simulate', 'ws.draft.save', 'ws.draft.nameTitle', 'ws.draft.nameSave', 'ws.draft.saved', 'ws.draft.leaveTitle', 'ws.draft.keep', 'ws.draft.discard'];
    for (const k of keys) for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l][k]?.length, `${l} ${k}`).toBeGreaterThan(2);
    for (const k of ['ws.draft.simulate', 'ws.draft.save', 'ws.draft.discard']) expect(DICT.en[k]).not.toBe(DICT.es[k]);
  });
});
