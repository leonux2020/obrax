// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { FREE_PROJECT_LIMIT, SIM_PRO_KEY, isPro } from '../src/lib/pro.js';
import { backToDashboard } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const tab = (name) => [...host.querySelectorAll('nav button')].find((b) => b.textContent.includes(name));

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 40));
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('PRO test switch inside the real App', () => {
  it('Dashboard "Descubre PRO" -> paywall -> "Activar PRO de prueba": PRO right away, modal closed, dashboard shows PRO activo', async () => {
    await mount();
    expect(q('pro-active')).toBeNull();
    await click(q('pro-scan'));
    expect(q('pro-paywall')).not.toBeNull();
    await click(q('pro-dev-activate'));
    expect(isPro()).toBe(true);
    expect(localStorage.getItem(SIM_PRO_KEY)).toBe('1');
    expect(q('pro-paywall')).toBeNull();
    expect(q('pro-active').textContent.trim()).toBe('PRO');
    expect(q('pro-active').getAttribute('aria-label')).toBe('PRO activo');
    expect(q('pro-scan')).toBeNull();
    await click(q('pro-active')); // the PRO button still opens the plans screen
    expect(q('pro-paywall')).not.toBeNull();
    expect(q('pro-active-note')).not.toBeNull();
  });

  it('PRO lifts the free-project limit at once (no reload): the 4th project opens the form, not the paywall', async () => {
    await mount();
    const create = async (name) => {
      await click(q('fab-new'));
      if (q('pro-paywall')) return false;
      typeInto(document.querySelector('[role="dialog"] input'), name);
      await click(q('project-save'));
      await flush(60);
      await backToDashboard();
      return true;
    };
    for (let i = 1; i <= FREE_PROJECT_LIMIT; i += 1) expect(await create(`Obra ${i}`)).toBe(true);
    await click(q('fab-new'));
    expect(q('pro-paywall')).not.toBeNull(); // free plan: blocked
    await click(q('pro-dev-activate'));
    expect(q('pro-paywall')).toBeNull();
    expect(await create('Obra 4')).toBe(true); // PRO: allowed straight away
    expect(host.querySelectorAll('[data-testid="project-card"]')).toHaveLength(FREE_PROJECT_LIMIT + 1);
  });

  it('a stored PRO flag is honoured on a fresh launch', async () => {
    localStorage.setItem(SIM_PRO_KEY, '1');
    await mount();
    expect(q('pro-active')).not.toBeNull();
    expect(q('pro-scan')).toBeNull();
  });
});
