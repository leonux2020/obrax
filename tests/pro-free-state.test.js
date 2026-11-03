// @vitest-environment happy-dom
// FREE users keep the standard look: with the global PRO flag OFF (or isPro false) the hard hat is NOT titanium (it stays the original green photo,
// no grayscale filter) and the PRO button is the invitation ("Descubre PRO"), never the active titanium state.
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import SplashScreen from '../src/components/SplashScreen.jsx';
import { Logo, TITANIUM_HELMET } from '../src/components/ui.jsx';
import { setSimulatedPro, isPro, SIM_PRO_KEY } from '../src/lib/pro.js';

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
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const FILTER = /grayscale|brightness-|contrast-/;
const dash = () => React.createElement(Dashboard, { projects: [], tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro: () => {} });

/** pro.js evaluated for a PRODUCTION bundle with the global flag switched OFF (the one-word edit `PRO_QA_OPEN = false`), reading the real source. */
const proModuleFlagOff = (env = { MODE: 'production', DEV: false, BASE_URL: '/' }) => {
  const src = fs
    .readFileSync('src/lib/pro.js', 'utf8')
    .replace('export const PRO_QA_OPEN = true', 'export const PRO_QA_OPEN = false')
    .replaceAll('import.meta.env', '__env')
    .replaceAll('export ', '');
  // eslint-disable-next-line no-new-func
  return new Function('__env', 'localStorage', 'window', 'location', `${src}\nreturn { isPro, aiAccess, projectLimitReached, qaProOpen, PRO_QA_OPEN, FREE_PROJECT_LIMIT };`)(env, localStorage, window, { hostname: 'obrax-khaki.vercel.app' });
};

describe('global PRO flag OFF in production => FREE for everybody', () => {
  it('the switch edit really produces a free build: isPro false, no AI access, project limit enforced, even with a leftover local PRO flag', () => {
    const pro = proModuleFlagOff();
    expect(pro.PRO_QA_OPEN).toBe(false);
    expect(pro.qaProOpen()).toBe(false);
    expect(pro.isPro()).toBe(false);
    localStorage.setItem(SIM_PRO_KEY, '1'); // the dev-only simulation flag cannot unlock a production bundle
    expect(pro.isPro()).toBe(false);
    expect(pro.aiAccess()).toBeNull();
    expect(pro.projectLimitReached(pro.FREE_PROJECT_LIMIT)).toBe(true);
  });

  it('the real switch is a single boolean (nothing else keeps PRO on)', () => {
    expect(fs.readFileSync('src/lib/pro.js', 'utf8').match(/PRO_QA_OPEN/g).length).toBeGreaterThanOrEqual(2);
    expect(fs.readFileSync('src/lib/pro.js', 'utf8')).toMatch(/export const PRO_QA_OPEN = (true|false);/);
  });
});

describe('FREE user: the hard hat keeps its original colour (no titanium filter)', () => {
  it('Logo with isPro={false}: no grayscale / brightness / contrast on the hat, in the three variants, and the photo is the original helmet.png', async () => {
    for (const variant of ['mark', 'imagotype', 'stacked']) {
      const tag = variant === 'mark' ? 'img' : 'image';
      await mount(React.createElement(Logo, { variant, isPro: false }));
      const hat = host.querySelector(`${tag}[data-testid="logo-helmet"]`);
      expect(hat.getAttribute('class') || '', variant).not.toMatch(FILTER);
      expect(hat.dataset.titanium, variant).toBeUndefined();
      expect(hat.getAttribute(tag === 'img' ? 'src' : 'href'), variant).toMatch(/helmet\.png$/);
      expect(host.innerHTML, variant).not.toMatch(FILTER);
      act(() => root.unmount());
      host.remove();
    }
  });

  it('Logo with NO prop follows the app flag: PRO off => no filter anywhere; the X stays brand green either way', async () => {
    expect(isPro()).toBe(false);
    await mount(React.createElement(Logo, { variant: 'stacked' }));
    expect(host.innerHTML).not.toMatch(FILTER);
    expect(q('logo').querySelector('path[data-letter="X"]').getAttribute('fill')).toBe('#22c55e');
  });

  it('the filter exists in ONE place only and is applied conditionally (never hard-coded on the hat)', () => {
    const ui = fs.readFileSync('src/components/ui.jsx', 'utf8');
    expect(TITANIUM_HELMET).toBe('grayscale brightness-125 contrast-125');
    expect(ui.match(/className=\{titanium \? TITANIUM_HELMET : undefined\}/g)).toHaveLength(2); // <img> and <image>
    const stripped = ui.replace(/export const TITANIUM_HELMET = '[^']*';/, '');
    expect(stripped).not.toMatch(/grayscale|brightness-125|contrast-125/);
    for (const f of fs.readdirSync('src/components').filter((n) => n.endsWith('.jsx') && n !== 'ui.jsx')) {
      expect(fs.readFileSync(`src/components/${f}`, 'utf8'), f).not.toMatch(/grayscale|TITANIUM_HELMET/);
    }
  });

  it('the welcome screen of a FREE user shows the original green hat', async () => {
    await mount(React.createElement(SplashScreen, { onStart: () => {} }));
    expect(q('splash-logo').querySelector('image[data-testid="logo-helmet"]').getAttribute('class') || '').not.toMatch(FILTER);
  });
});

describe('FREE user: the PRO button is the invitation', () => {
  it('Dashboard: "Descubre PRO" (pro-scan), muted outline, no titanium state, and every logo in the bar is unfiltered', async () => {
    await mount(dash());
    const btn = q('pro-scan');
    expect(btn).not.toBeNull();
    expect(q('pro-active')).toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Descubre PRO');
    expect(btn.dataset.pro).toBeUndefined();
    const pill = q('pro-pill');
    expect(pill.className).toContain('border-white/15');
    expect(pill.className).toContain('text-white/60');
    expect(pill.className).not.toMatch(/(^|\s)border-slate-500\/50/); // the active titanium border is NOT there
    expect(pill.className).not.toMatch(/(^|\s)text-slate-300/);
    for (const hat of host.querySelectorAll('[data-testid="logo-helmet"]')) expect(hat.getAttribute('class') || '').not.toMatch(FILTER);
    expect(host.querySelector('[data-testid="dash-header"]').innerHTML).not.toMatch(FILTER);
  });

  it('live switch: the plan changing flips the SAME screen titanium <-> standard (button and hat together), both ways', async () => {
    await mount(dash());
    expect(q('pro-scan')).not.toBeNull();
    await act(async () => setSimulatedPro(true));
    expect(q('pro-active')).not.toBeNull();
    expect(q('pro-pill').className).toContain('text-slate-300');
    expect(host.querySelector('[data-testid="logo-helmet"]').getAttribute('class')).toMatch(FILTER);
    await act(async () => setSimulatedPro(false)); // back to FREE
    expect(q('pro-scan')).not.toBeNull();
    expect(q('pro-active')).toBeNull();
    expect(q('pro-pill').className).toContain('text-white/60');
    expect(q('pro-pill').className).not.toMatch(/(^|\s)text-slate-300/); // only the hover hint (group-hover:) may mention it
    expect(host.querySelector('[data-testid="logo-helmet"]').getAttribute('class') || '').not.toMatch(FILTER);
  });
});
