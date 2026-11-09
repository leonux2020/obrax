// @vitest-environment happy-dom
// ProjectWorkspace inside the real App (the only project screen) and the global deferred-receipt sync.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { resetToasts } from '../src/lib/notify.js';
import { createProjectViaDraft } from './helpers/appHarness.js';
import { geminiReply, seedKey } from './helpers/gemini.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const JPEG = `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 300 }, (_, i) => i % 200)).toString('base64')}`;

let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const deviceBack = async () => {
  await act(async () => {
    window.history.back();
  });
  await act(async () => new Promise((r) => setTimeout(r, 30)));
};
const wait = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); });
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 60));
  });
}
async function newProjectIntoWorkspace() {
  await createProjectViaDraft('Casa Soto');
  resetToasts(); // the "Proyecto guardado" toast is not what these tests look at
  for (let i = 0; i < 8 && !q('project-workspace'); i += 1) {
    if (q('wizard-back')) await click(q('wizard-back'));
    else break;
  }
}

beforeEach(async () => {
  localStorage.clear();
  seedKey(); // BYOK: the user's own key is saved on this device
  resetToasts();
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('App with the workspace (the only project screen)', () => {
  it('there is no flag any more: an old "?workspace=0" opt-out stored on the device is ignored and the file is gone from the source', async () => {
    localStorage.setItem('cp.flag.workspace', '0');
    await mount();
    await newProjectIntoWorkspace();
    expect(q('project-workspace')).not.toBeNull();
    expect(q('wizard-back')).toBeNull();
    expect(q('pv-back')).toBeNull();
    expect(existsSync('src/lib/flags.js')).toBe(false);
    for (const gone of ['components/Wizard.jsx', 'components/ProjectView.jsx', 'components/steps']) expect(existsSync(`src/${gone}`), gone).toBe(false);
    expect(readFileSync('src/App.jsx', 'utf8')).not.toMatch(/Wizard|ProjectView|workspaceEnabled|wsOn|setEditor/);
  });

  it('a NEW project goes straight into the workspace (never the wizard), with the first partida open; back returns to the dashboard', async () => {
    await mount(); // no flag stored: the default is on
    await newProjectIntoWorkspace();
    expect(q('project-workspace')).not.toBeNull();
    expect(q('wizard-back')).toBeNull();
    expect(q('project-view')).toBeNull();
    expect(q('ws-title').textContent).toBe('Casa Soto');
    expect(q('partida-add')).not.toBeNull(); // a detailed job starts with an empty list and the door to add the first partida
    expect(q('ws-advanced')).toBeNull(); // and there is no door to the old editor
    await deviceBack();
    expect(q('dash-empty') || q('project-card')).not.toBeNull();
    await click(document.querySelector('[data-testid="project-card"]')); // opening an existing project lands in the workspace too
    expect(q('project-workspace')).not.toBeNull();
  });

  it('a receipt parked while offline is sent when the network returns, lands in ITS project and the user is told', async () => {
    await mount();
    await newProjectIntoWorkspace();
    const [project] = await projectStore.load();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await act(async () => {
      await receiptQueue.enqueue({ projectId: project.id, image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es' });
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => geminiReply({ isReceipt: true, currency: 'CLP', supplier: 'Easy', items: [{ description: 'Taladro', amountText: '$25.000', category: 'tool_rental', returnDate: '2099-01-01' }] }));
    await wait(40);
    expect(fetchSpy).not.toHaveBeenCalled(); // offline: nothing is sent
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(q('toast')?.textContent).toMatch(/Boletas leídas: 1/);
    await click(q('ws-expenses'));
    expect(q('expense-list').textContent).toContain('Taladro');
    expect(q('expense-list').textContent).toContain('25.000');
    expect(receiptQueue.peek()).toHaveLength(0);
    await wait(300); // the open project is persisted by the usual debounce
    const saved = (await projectStore.load())[0];
    expect(saved.expenses.map((e) => e.description)).toEqual(['Taladro']);
  });

  it('ONE parked photo with three receipts lands as three documents in ITS project: every saved expense carries the project id', async () => {
    await mount();
    await newProjectIntoWorkspace();
    const [project] = await projectStore.load();
    await act(async () => {
      await receiptQueue.enqueue({ projectId: project.id, image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es' });
    });
    const doc = (supplier, description, amountText) => ({ supplier, currency: 'CLP', items: [{ description, amountText, category: 'material' }] });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => geminiReply({ isReceipt: true, receipts: [doc('Easy', 'Taladro', '$25.000'), doc('Sodimac', 'Cemento', '$9.980'), doc('Copec', 'Diésel', '$30.000')] }));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(q('toast')?.textContent).toMatch(/Boletas leídas: 1 · gastos añadidos: 3/);
    await wait(300);
    const saved = (await projectStore.load())[0];
    expect(saved.expenses.map((e) => e.description).sort()).toEqual(['Cemento', 'Diésel', 'Taladro']);
    expect(saved.expenses.every((e) => e.projectId === project.id)).toBe(true);
    expect(saved.expenses.every((e) => e.currency === 'CLP')).toBe(true);
    expect(new Set(saved.expenses.map((e) => e.docId)).size).toBe(3);
  });
});
