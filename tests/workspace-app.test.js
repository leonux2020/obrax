// @vitest-environment happy-dom
// ProjectWorkspace inside the real App (behind the ?workspace=1 flag) and the global deferred-receipt sync.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { resetToasts } from '../src/lib/notify.js';
import { DEFAULT_WORKSPACE, workspaceEnabled } from '../src/lib/flags.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const JPEG = `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 300 }, (_, i) => i % 200)).toString('base64')}`;

let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
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
  await click(q('fab-new'));
  typeInto(document.querySelector('[role="dialog"] input'), 'Casa Soto');
  await click(q('project-save'));
  for (let i = 0; i < 8 && !q('ws-back'); i += 1) {
    if (q('wizard-back')) await click(q('wizard-back'));
    else break;
  }
}

beforeEach(async () => {
  localStorage.clear();
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

describe('feature flag', () => {
  it('is ON by default; ?workspace=0 is the remembered emergency opt-out and ?workspace=1 brings it back', () => {
    expect(DEFAULT_WORKSPACE).toBe(true);
    expect(workspaceEnabled()).toBe(true);
    localStorage.setItem('cp.flag.workspace', '0');
    expect(workspaceEnabled()).toBe(false);
    localStorage.setItem('cp.flag.workspace', '1');
    expect(workspaceEnabled()).toBe(true);
  });
});

describe('App with the workspace (default)', () => {
  it('a NEW project goes straight into the workspace (never the wizard), with the first partida open; back returns to the dashboard', async () => {
    await mount(); // no flag stored: the default is on
    await newProjectIntoWorkspace();
    expect(q('project-workspace')).not.toBeNull();
    expect(q('wizard-back')).toBeNull();
    expect(q('project-view')).toBeNull();
    expect(q('ws-title').textContent).toBe('Casa Soto');
    expect(q('partida-0').open).toBe(true); // the measures are right there
    expect(q('ws-advanced')).toBeNull(); // and there is no door to the old editor
    await click(q('ws-back'));
    expect(q('dash-empty') || q('project-card')).not.toBeNull();
    await click(document.querySelector('[data-testid="project-card"]')); // opening an existing project lands in the workspace too
    expect(q('project-workspace')).not.toBeNull();
  });

  it('emergency opt-out (?workspace=0): the classic wizard + project view are still there', async () => {
    localStorage.setItem('cp.flag.workspace', '0');
    await mount();
    await click(q('fab-new'));
    typeInto(document.querySelector('[role="dialog"] input'), 'Casa Soto');
    await click(q('project-save'));
    for (let i = 0; i < 8 && !q('pv-back'); i += 1) {
      if (q('wizard-back')) await click(q('wizard-back'));
      else break;
    }
    expect(q('project-view')).not.toBeNull();
    expect(q('project-workspace')).toBeNull();
  });

  it('a receipt parked while offline is sent when the network returns, lands in ITS project and the user is told', async () => {
    await mount();
    await newProjectIntoWorkspace();
    const [project] = await projectStore.load();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await act(async () => {
      await receiptQueue.enqueue({ projectId: project.id, image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es' });
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, isReceipt: true, currency: 'CLP', supplier: 'Easy', items: [{ description: 'Taladro', amountText: '$25.000', category: 'tool_rental', returnDate: '2099-01-01' }] }) }));
    await wait(40);
    expect(fetchSpy).not.toHaveBeenCalled(); // offline: nothing is sent
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(q('toast')?.textContent).toMatch(/Boletas leídas: 1/);
    await click(q('ws-expenses').querySelector('summary'));
    expect(q('expense-list').textContent).toContain('Taladro');
    expect(q('expense-list').textContent).toContain('25.000');
    expect(receiptQueue.peek()).toHaveLength(0);
    await wait(300); // the open project is persisted by the usual debounce
    const saved = (await projectStore.load())[0];
    expect(saved.expenses.map((e) => e.description)).toEqual(['Taladro']);
  });
});
