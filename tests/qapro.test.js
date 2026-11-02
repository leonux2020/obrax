// @vitest-environment happy-dom
// Temporary quality-control build: the paywall is open in every environment (silently: no badge anywhere).
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import SettingsView from '../src/components/SettingsView.jsx';
import { PRO_QA_OPEN, qaProOpen, isPro, aiAccess, projectLimitReached, FREE_PROJECT_LIMIT } from '../src/lib/pro.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  act(() => root?.unmount());
  host?.remove();
});
const mount = async (node) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node)));
};
const q = (id) => document.querySelector(`[data-testid="${id}"]`);

describe('PRO paywall open for quality control', () => {
  it('the switch is on and is open in EVERY environment except the test runner (no localhost condition)', () => {
    expect(PRO_QA_OPEN).toBe(true);
    for (const mode of ['production', 'development', 'preview', 'staging']) expect(qaProOpen({ mode }), mode).toBe(true);
    expect(qaProOpen({ mode: 'test' })).toBe(false); // so the paywall logic stays testable
    expect(qaProOpen({ flag: false, mode: 'production' })).toBe(false); // one flag brings the paywall back
    expect(fs.readFileSync('src/lib/pro.js', 'utf8')).toMatch(/export const PRO_QA_OPEN = true/);
  });

  it('in a production-like environment isPro() is always true: no limit on projects, AI scanners open', () => {
    expect(isPro()).toBe(false); // the test runner keeps the real gate...
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('DEV', false);
    expect(isPro()).toBe(true); // ...production is open, with no subscription and no localStorage flag
    expect(localStorage.getItem('cp.pro.sim.v1')).toBeNull();
    expect(aiAccess()).toBe('pro'); // receipt scanner + invoice reading
    expect(projectLimitReached(FREE_PROJECT_LIMIT + 50)).toBe(false);
    expect(projectLimitReached(10_000, isPro())).toBe(false);
  });

  it('the Dashboard shows the PRO button as active and NO "MODO PRO (Prueba)" text any more (zero-stress header)', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('DEV', false);
    await mount(React.createElement(Dashboard, { projects: [], tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro: () => {} }));
    expect(q('pro-active')).not.toBeNull();
    expect(q('pro-scan')).toBeNull();
    expect(q('qa-pro-tag')).toBeNull();
    expect(host.textContent).not.toMatch(/MODO PRO/i);
  });

  it('Ajustes does NOT carry the tag either: its title is just "Ajustes", the component and the label are gone for good', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('DEV', false);
    await mount(React.createElement(SettingsView, { settings: { region: 'CL', lang: 'es' }, user: { name: 'Ana', email: 'a@b.cl', provider: 'local' }, company: null, logo: '', onChange: () => {} }));
    expect(q('qa-pro-tag')).toBeNull();
    expect(host.textContent).not.toMatch(/MODO PRO|Prueba/i);
    expect(q('settings-title').textContent).toBe('Ajustes');
    expect(fs.existsSync('src/components/ProQaTag.jsx')).toBe(false);
    expect(fs.readFileSync('src/lib/pro.js', 'utf8')).not.toContain('PRO_QA_LABEL');
    expect(fs.readFileSync('src/components/SettingsView.jsx', 'utf8')).not.toMatch(/ProQaTag|qa-pro-tag/);
  });

  it('in the test runner the tag is not shown (the real paywall is what tests exercise)', async () => {
    await mount(React.createElement(Dashboard, { projects: [], tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro: () => {} }));
    expect(q('qa-pro-tag')).toBeNull();
    expect(q('pro-scan')).not.toBeNull();
  });
});
