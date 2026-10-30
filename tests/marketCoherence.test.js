// @vitest-environment happy-dom
// Coherence of the market: flag, currency and money format come from ONE source, the project's regionCode, never from the UI language
// or the stored default; a wrong market can be corrected from the project's settings; the first paint is never empty or white.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { makeI18n } from '../src/lib/i18n.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import Header from '../src/components/Header.jsx';
import AppShell from '../src/components/AppShell.jsx';
import App, { resetBoot } from '../src/App.jsx';
import { newProject } from '../src/lib/projects.js';
import { withMarket } from '../src/lib/workspaceModel.js';
import { projectStore } from '../src/lib/projectStore.js';
import { q, flush, click, typeInto, createHost } from './helpers/appHarness.js';
import { resetDevice, setDevice } from './helpers/device.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => resetDevice());
const nb = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('money is bound to the project market (regionCode), not to the UI language', () => {
  it('an Italian project in an Italian UI: 1.234,50 € (it-IT, EUR)', () => {
    const { money, region } = makeI18n('it', 'IT');
    expect(region.code).toBe('IT');
    expect(nb(money(1234.5))).toBe('1.234,50 €');
  });

  it('the same Italian project in any UI language keeps euros and Italian formatting (never a "$")', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'de', 'it']) {
      const text = nb(makeI18n(lang, 'IT').money(1234.5));
      expect(text, lang).toBe('1.234,50 €');
      expect(text).not.toContain('$');
      expect(text).not.toContain('CLP');
    }
  });

  it('a Chilean project in an Italian UI stays CLP, with no decimals and no euro anywhere', () => {
    const text = nb(makeI18n('it', 'CL').money(1234567));
    expect(text).toContain('$');
    expect(text).not.toContain('€');
    expect(text).not.toContain(',');
  });

  it('Intl is built with the region locale + the region currency (it-IT + EUR is a real format test)', () => {
    const { moneyLocale, region } = makeI18n('it', 'IT');
    expect(moneyLocale).toBe('it-IT');
    expect(region.currency).toBe('EUR');
    expect(nb(new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(1234.5))).toBe(nb(makeI18n('it', 'IT').money(1234.5)));
  });

  it('an amount printed in ANOTHER currency (an EUR receipt inside a CLP job) keeps its own symbol; the job currency uses the job format', () => {
    const { moneyIn } = makeI18n('it', 'CL');
    expect(nb(moneyIn(45, 'EUR'))).toContain('€');
    expect(nb(moneyIn(45, 'EUR'))).not.toContain('$');
    expect(nb(moneyIn(45000, 'CLP'))).toContain('$');
    expect(nb(moneyIn(45000, ''))).toContain('$');
    expect(nb(moneyIn(45000, undefined))).toContain('$');
    expect(nb(moneyIn(1, 'XXXX'))).toContain('$'); // not an ISO code: the project's money
    expect(nb(moneyIn(5, 'USD'))).toContain('USD'); // "$" would be ambiguous next to the CLP "$": the code tells them apart
  });
});

describe('ProjectSheet: the market of an existing project can be corrected (flag + currency follow)', () => {
  let host;
  let root;
  const qs = (id) => document.querySelector(`[data-testid="${id}"]`);
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const open = (props) => act(async () => root.render(React.createElement(I18nProvider, { lang: 'it', regionCode: 'CL' }, React.createElement(ProjectSheet, { onSave: () => {}, onClose: () => {}, ...props }))));

  it('shows the project market, warns when it changes and sends the new regionCode', async () => {
    const saved = [];
    await open({ project: newProject({ regionCode: 'CL', name: 'Casa' }), onSave: (f) => saved.push(f), onDelete: () => {} });
    const input = () => qs('project-market').querySelector('input[role="combobox"]');
    expect(input().value).toBe('🇨🇱 Cile');
    expect(qs('project-market-warn')).toBeNull();
    await click(input());
    await click(document.querySelector('[role="option"][id$="-opt-IT"]'));
    expect(qs('project-market-hint').textContent).toContain('🇮🇹');
    expect(qs('project-market-hint').textContent).toContain('EUR');
    expect(qs('project-market-warn')).not.toBeNull();
    await click(qs('project-save'));
    expect(saved[0].regionCode).toBe('IT');
  });

  it('a signed / frozen quote keeps its market: no picker, the locked market is shown', async () => {
    const p = newProject({ regionCode: 'CL', name: 'Casa' });
    p.draft = { ...p.draft, frozen: { at: 1 } };
    await open({ project: p, onDelete: () => {} });
    expect(qs('project-market').querySelector('input[role="combobox"]')).toBeNull();
    expect(qs('project-market-locked').textContent).toContain('CLP');
  });

  it('withMarket (the rule the save applies): new code -> new market, prices and tax reset; same code or locked -> untouched', () => {
    const p = newProject({ regionCode: 'CL', name: 'Casa' });
    const it = withMarket(p.draft, 'IT');
    expect(it.regionCode).toBe('IT');
    expect(it.overrides).toEqual({});
    expect(withMarket(p.draft, 'CL')).toBe(p.draft);
    const locked = { ...p.draft, frozen: { at: 1 } };
    expect(withMarket(locked, 'IT')).toBe(locked);
  });
});

describe('App: Italy end to end (flag, currency and money agree) and a stale Chile can be fixed', () => {
  let h;
  const seed = (settings) => {
    localStorage.clear();
    localStorage.setItem('cp.settings.v1', JSON.stringify(settings));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
  };
  beforeEach(async () => {
    for (const p of await projectStore.load()) await projectStore.remove(p.id);
  });
  afterEach(() => {
    h?.unmount();
    localStorage.clear();
  });

  it('a new job in Italy is IT / EUR with the Italian UI, overwrites the stored Chile and shows 🇮🇹 and € (no $)', async () => {
    seed({ region: 'CL', lang: 'es' });
    setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT', 'it'] });
    h = createHost(App);
    await h.mount();
    await click(q('fab-new'));
    await typeInto(document.querySelector('[role="dialog"] input'), 'Casa Rossi');
    await click(q('project-save'));
    await flush(400);
    const [project] = await projectStore.load();
    expect(project.draft.regionCode).toBe('IT');
    expect(JSON.parse(localStorage.getItem('cp.settings.v1')).region).toBe('IT'); // the stored default follows the device
    expect(document.body.textContent).toContain('🇮🇹');
    expect(document.body.textContent).not.toContain('🇨🇱');
    expect(nb(document.body.textContent)).not.toMatch(/\$\s?\d/);
  });

  it('with the device unable to tell (no zone, no country) the job still gets a valid stored market', async () => {
    seed({ region: 'PE', lang: 'es' });
    setDevice({ timeZone: 'Etc/UTC', languages: ['en'] });
    h = createHost(App);
    await h.mount();
    await click(q('fab-new'));
    await click(q('project-save'));
    await flush(400);
    expect((await projectStore.load())[0].draft.regionCode).toBe('PE');
  });
});

describe('No blink: the shell never disappears while IndexedDB is read, the offline banner is dark', () => {
  let host;
  let root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('AppShell is a black block with a busy flag, never nothing', async () => {
    await act(async () => root.render(React.createElement(AppShell)));
    const shell = host.querySelector('[data-testid="app-shell"]');
    expect(shell).not.toBeNull();
    expect(shell.getAttribute('aria-busy')).toBe('true');
    expect(shell.className).toContain('bg-black');
    expect(shell.outerHTML).not.toMatch(/bg-white(?![/\w])/);
  });

  it('App renders the shell + bottom navigation (not null) until the projects arrive', async () => {
    localStorage.clear();
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    const real = projectStore.load;
    let release;
    projectStore.load = () => new Promise((r) => { release = () => r([]); });
    resetBoot();
    const h = createHost(App);
    try {
      await h.mount();
      await flush(300);
      expect(document.querySelector('[data-testid="app-shell"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="nav-projects"]')).not.toBeNull();
      await act(async () => release?.());
      await flush(100);
    } finally {
      projectStore.load = real;
      resetBoot();
      h.unmount();
      localStorage.clear();
    }
  });

  it('the offline banner is black with amber text (it used to be a white bar that flashed on every connectivity change)', async () => {
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Header, { pwa: { online: false, updateReady: false }, bare: true }))));
    const banner = host.querySelector('[role="status"]');
    expect(banner.className).toContain('bg-black');
    expect(banner.className).not.toMatch(/bg-white(?![/\w])/);
  });

  it('index.html opens with the dark color-scheme and theme-color; nothing in the head paints white; CSS keeps #000000', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head.indexOf('name="color-scheme" content="dark"')).toBeGreaterThan(-1);
    expect(head.indexOf('name="theme-color" content="#000000"')).toBeGreaterThan(-1);
    expect(head.indexOf('name="color-scheme"')).toBeLessThan(head.indexOf('<title>')); // before anything heavy
    expect(head.indexOf('name="theme-color"')).toBeLessThan(head.indexOf('<title>'));
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*background-color:\s*#000000/);
  });
});
