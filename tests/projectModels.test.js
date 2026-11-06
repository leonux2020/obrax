// @vitest-environment happy-dom
// Project creation / edition: the budget model first (Llave en mano / Detallado), then the 7 real-world types of work as a grid of cards (no dropdown).
// Both are optional labels of the project: older projects and jobs created without choosing stay exactly as they were.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, backToDashboard, q, flush, click, typeInto, installFakeGoogle, createHost, saveDraftAs } from './helpers/appHarness.js';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import { BUDGET_MODELS, WORK_TYPES, cleanBudgetModel, cleanWorkType, modeForBudget, newProject, normalizeProject, normalizeProjects } from '../src/lib/projects.js';
import { parseBackup } from '../src/lib/backup.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de'];
const TYPE_ES = ['Obra Nueva / Llave en Mano', 'Remodelación / Ampliación', 'Movimiento de Tierras / Exteriores', 'Obra Gruesa / Estructura', 'Instalaciones (Eléctrica, Clima, Sanitaria)', 'Terminaciones y Acabados', 'Mantenimiento / Reparaciones'];

describe('model: budgetModel + workType are optional, validated and backward compatible', () => {
  it('the closed lists', () => {
    expect(BUDGET_MODELS).toEqual(['turnkey', 'detailed']);
    expect(WORK_TYPES).toHaveLength(7);
    expect(WORK_TYPES.map((w) => DICT.es[`worktype.${w}`])).toEqual(TYPE_ES);
  });
  it('turnkey -> one global line (quick); detailed -> partida by partida (project); nothing chosen -> what was asked, as always', () => {
    expect(modeForBudget('turnkey')).toBe('quick');
    expect(modeForBudget('detailed')).toBe('project');
    expect(modeForBudget('', 'project')).toBe('project');
    expect(modeForBudget('junk', 'quick')).toBe('quick');
    expect(newProject({ regionCode: 'CL', budgetModel: 'detailed' }).draft.mode).toBe('project');
    expect(newProject({ regionCode: 'CL', budgetModel: 'turnkey' }).draft.mode).toBe('quick');
    expect(newProject({ regionCode: 'CL', mode: 'project' }).draft.mode).toBe('project');
  });
  it('a new job stores both; a job created without choosing carries NO new keys', () => {
    const p = newProject({ regionCode: 'CL', budgetModel: 'turnkey', workType: 'remodel' });
    expect(p).toMatchObject({ budgetModel: 'turnkey', workType: 'remodel' });
    const plain = newProject({ regionCode: 'CL' });
    expect('budgetModel' in plain).toBe(false);
    expect('workType' in plain).toBe(false);
    expect(newProject({ regionCode: 'CL', budgetModel: '<b>', workType: 'x' })).not.toHaveProperty('workType');
  });
  it('normalizeProject keeps valid values, drops junk, and an OLD record (no fields) is untouched; a storage round trip keeps them', () => {
    const base = newProject({ regionCode: 'CL', name: 'Casa' });
    const old = JSON.parse(JSON.stringify(base));
    expect(normalizeProject(old)).not.toHaveProperty('budgetModel');
    expect(normalizeProject(old)).not.toHaveProperty('workType');
    expect(normalizeProject({ ...old, budgetModel: 'detailed', workType: 'structure' })).toMatchObject({ budgetModel: 'detailed', workType: 'structure' });
    const bad = normalizeProject({ ...old, budgetModel: 'hack', workType: { a: 1 } });
    expect(bad).not.toHaveProperty('budgetModel');
    expect(bad).not.toHaveProperty('workType');
    expect(cleanBudgetModel(null)).toBe('');
    expect(cleanWorkType(undefined)).toBe('');
    const withBoth = { ...base, budgetModel: 'turnkey', workType: 'finishes' };
    const [back] = normalizeProjects(JSON.parse(JSON.stringify([withBoth]))); // what storage / a backup does to it
    expect(back).toMatchObject({ budgetModel: 'turnkey', workType: 'finishes' });
  });
});

describe('ProjectSheet: progressive disclosure, cards and pills, no dropdowns', () => {
  let host;
  let root;
  const render = async (props = {}) => {
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ProjectSheet, { onSave: () => {}, onClose: () => {}, ...props })));
    });
    await flush();
  };
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('NEW: two big cards first; the 7 types are hidden until a model is chosen', async () => {
    await render();
    const cards = ['turnkey', 'detailed'].map((m) => q(`budget-${m}`));
    expect(cards.every(Boolean)).toBe(true);
    expect(q('budget-model').getAttribute('role')).toBe('radiogroup');
    expect(cards[0].textContent).toContain('Llave en mano');
    expect(cards[0].textContent).toContain('precio fijo por m²');
    expect(cards[1].textContent).toContain('Detallado');
    expect(cards[1].textContent).toContain('Bottom-Up');
    for (const c of cards) {
      expect(c.className).toContain('min-h-[112px]');
      expect(c.className).toContain('active:scale-95');
      expect(c.className).toContain('rounded-2xl');
      expect(c.className).toContain('bg-white/5');
      expect(c.className).not.toMatch(/\bborder\b|bg-neutral|bg-gray/);
      expect(c.getAttribute('aria-checked')).toBe('false');
    }
    expect(q('work-type-block')).toBeNull(); // progressive disclosure
    expect(host.querySelector('select')).toBeNull();
    expect(q('budget-model-block').compareDocumentPosition(host.querySelector('[data-testid="new-form"]').querySelector('input[type="date"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('choosing a model lights its card and reveals the 7 types as a grid of pills (no select, no dropdown), in the agreed order and wording', async () => {
    await render();
    await click(q('budget-turnkey'));
    expect(q('budget-turnkey').getAttribute('aria-checked')).toBe('true');
    expect(q('budget-turnkey').className).toContain('bg-brand/15');
    expect(q('budget-detailed').getAttribute('aria-checked')).toBe('false');
    const grid = q('work-type');
    expect(grid.className).toContain('grid');
    const pills = [...grid.querySelectorAll('[role="radio"]')];
    expect(pills.map((b) => b.textContent)).toEqual(TYPE_ES);
    expect(pills.map((b) => b.dataset.testid)).toEqual(WORK_TYPES.map((w) => `worktype-${w}`));
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('datalist')).toBeNull();
    for (const b of pills) {
      expect(b.className).toContain('active:scale-95');
      expect(b.className).toContain('bg-white/5');
      expect(b.className).toContain('min-h-[56px]');
      expect(b.className).not.toMatch(/\bborder\b|bg-neutral|bg-gray/);
    }
  });

  it('a type lights up (brand tint), only one at a time, and tapping it again clears it', async () => {
    await render();
    await click(q('budget-detailed'));
    await click(q('worktype-earthworks'));
    expect(q('worktype-earthworks').getAttribute('aria-checked')).toBe('true');
    expect(q('worktype-earthworks').className).toContain('bg-brand/15');
    await click(q('worktype-finishes'));
    expect(q('worktype-earthworks').getAttribute('aria-checked')).toBe('false');
    expect(q('worktype-finishes').getAttribute('aria-checked')).toBe('true');
    await click(q('worktype-finishes'));
    expect(host.querySelectorAll('[data-testid^="worktype-"][aria-checked="true"]')).toHaveLength(0);
  });

  it('the payload carries mode (from the model), budgetModel and workType; with nothing chosen it is the old payload (mode quick, empty labels)', async () => {
    const saved = [];
    await render({ onSave: (p) => saved.push(p) });
    await click(q('project-save'));
    expect(saved[0]).toMatchObject({ mode: 'quick', budgetModel: '', workType: '' });
    await click(q('budget-detailed'));
    await click(q('worktype-installations'));
    await click(q('project-save'));
    expect(saved[1]).toMatchObject({ mode: 'project', budgetModel: 'detailed', workType: 'installations' });
    await click(q('budget-turnkey'));
    await click(q('project-save'));
    expect(saved[2]).toMatchObject({ mode: 'quick', budgetModel: 'turnkey', workType: 'installations' });
  });

  it('EDIT: the type is always visible and editable; the model (it fixed the mode) is a quiet read-only line; an old project shows neither selection', async () => {
    const saved = [];
    const p = { ...newProject({ regionCode: 'CL', name: 'Casa', budgetModel: 'detailed', workType: 'structure' }) };
    await render({ project: p, onSave: (v) => saved.push(v) });
    expect(q('budget-model')).toBeNull();
    expect(q('budget-model-readonly').textContent).toContain('Detallado');
    expect(q('worktype-structure').getAttribute('aria-checked')).toBe('true');
    await click(q('worktype-maintenance'));
    await click(q('project-save'));
    expect(saved[0]).toMatchObject({ workType: 'maintenance' });
    act(() => root.unmount());
    root = createRoot(host);
    const legacy = newProject({ regionCode: 'CL', name: 'Vieja' });
    await render({ project: legacy, onSave: (v) => saved.push(v) });
    expect(q('budget-model-readonly')).toBeNull();
    expect(host.querySelectorAll('[data-testid^="worktype-"][aria-checked="true"]')).toHaveLength(0);
    await click(q('project-save'));
    expect(saved[1].workType).toBe('');
  });
});

describe('App: create and edit end to end (checked in the Drive backup)', () => {
  let App;
  let drive;
  let h;
  beforeAll(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    App = (await import('../src/App.jsx')).default;
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearDriveToken();
    drive = createFakeDrive();
    vi.stubGlobal('fetch', drive.fetchImpl);
    installFakeGoogle(drive);
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    localStorage.setItem('cp.drive.linked.v1', '1');
    setDriveToken(drive.token, 3600);
  });
  afterEach(() => {
    h?.unmount();
    vi.unstubAllGlobals();
    delete window.google;
  });

  it('a new job keeps the model + type; editing the type later keeps the model; an old project is never rewritten with them', async () => {
    h = createHost(App);
    await h.mount();
    await click(q('fab-new'));
    await click(q('ws-edit')); // the draft's details: model + type are chosen here, before saving for good
    typeInto(document.querySelector('[role="dialog"] input'), 'Casa Norte');
    await click(q('budget-detailed'));
    await click(q('worktype-remodel'));
    await click(q('project-save'));
    await saveDraftAs('Casa Norte');
    expect(q('project-workspace')).not.toBeNull();
    await flush(5600);
    const first = parseBackup(drive.backupFiles()[0].body).projects[0];
    expect(first).toMatchObject({ budgetModel: 'detailed', workType: 'remodel' });
    expect(first.draft.mode).toBe('project');
    await click(q('ws-edit'));
    await click(q('worktype-finishes'));
    await click(q('project-save'));
    await flush(5600);
    const second = parseBackup(drive.backupFiles()[0].body).projects[0];
    expect(second).toMatchObject({ budgetModel: 'detailed', workType: 'finishes' });
    expect(second.draft.project.name).toBe('Casa Norte');
    await click(q('ws-edit'));
    await click(q('worktype-finishes')); // tap again: cleared
    await click(q('project-save'));
    await flush(5600);
    const third = parseBackup(drive.backupFiles()[0].body).projects[0];
    expect(third).not.toHaveProperty('workType');
    expect(third.budgetModel).toBe('detailed');
    await backToDashboard();
  }, 40_000);
});

describe('the new words', () => {
  it('the model and the 7 types exist in the six languages, different from each other', () => {
    const keys = ['newp.budget', 'newp.budget.turnkey', 'newp.budget.turnkey.sub', 'newp.budget.detailed', 'newp.budget.detailed.sub', 'newp.worktype', ...WORK_TYPES.map((w) => `worktype.${w}`)];
    for (const k of keys) {
      for (const l of LANGS) expect(DICT[l][k]?.length, `${l} ${k}`).toBeGreaterThan(3);
      expect(new Set(LANGS.map((l) => DICT[l][k])).size, k).toBeGreaterThanOrEqual(5); // Bottom-Up is the same word in several languages
    }
  });
});
