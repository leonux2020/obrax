// @vitest-environment happy-dom
// SPA navigation stack: Contabilidad is ONE history entry over Proyectos, a sheet over it is another one, and the device's Back
// unwinds them in order (sheet -> Contabilidad -> Proyectos) without ever restarting the app or skipping steps.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { resetBoot } from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(10);
};
const deviceBack = async () => {
  await act(async () => {
    window.history.back();
  });
  await flush(30);
};

beforeEach(async () => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  window.history.replaceState(null, '');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
  const p = newProject({ regionCode: 'CL', name: 'Casa Soto', client: 'Luis' });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  p.payments = [{ id: 'pay001', amount: 1000, at: Date.now() - 3600_000, note: '' }];
  await projectStore.save(p);
  resetBoot();
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('navigation stack (device Back)', () => {
  it('Proyectos -> Contabilidad pushes one entry; Back returns to Proyectos, ordered', async () => {
    expect(q('project-card')).not.toBeNull();
    await click(q('nav-accounting'));
    expect(q('accounting')).not.toBeNull();
    expect(window.history.state).toEqual({ cubraxTab: 'accounting' });
    await deviceBack();
    expect(q('accounting')).toBeNull();
    expect(q('project-card')).not.toBeNull(); // the Dashboard, not a restarted app
    expect(window.history.state?.cubraxTab).toBeUndefined();
  });

  it('tapping the Proyectos tab drops the entry: Back is not needed twice', async () => {
    const back = vi.spyOn(window.history, 'back');
    await click(q('nav-accounting'));
    await click(q('nav-projects'));
    await flush(30);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.history.state?.cubraxTab).toBeUndefined();
    expect(q('project-card')).not.toBeNull();
  });

  it('with the breakdown sheet open Back closes ONLY the sheet; a second Back leaves Contabilidad', async () => {
    await click(q('nav-accounting'));
    await click(q('acc-hud'));
    expect(q('acc-sheet')).not.toBeNull();
    expect(window.history.state).toMatchObject({ cubraxSheet: 'open', modalOpen: true });
    await deviceBack();
    expect(q('acc-sheet')).toBeNull();
    expect(q('accounting')).not.toBeNull(); // still in Contabilidad Global
    expect(window.history.state).toEqual({ cubraxTab: 'accounting' });
    await deviceBack();
    expect(q('accounting')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('closing the sheet with the backdrop leaves exactly the Contabilidad entry (one Back goes to Proyectos)', async () => {
    await click(q('nav-accounting'));
    await click(q('acc-hud'));
    await click(q('sheet-backdrop'));
    await flush(30);
    expect(q('acc-sheet')).toBeNull();
    expect(window.history.state).toEqual({ cubraxTab: 'accounting' });
    await deviceBack();
    expect(q('project-card')).not.toBeNull();
  });

  it('opening a project from Proyectos and pressing Back still lands on the Dashboard (unchanged)', async () => {
    await click(q('project-card'));
    expect(window.history.state?.cubraxProject).toBeTruthy();
    await deviceBack();
    expect(q('project-card')).not.toBeNull();
  });
});
