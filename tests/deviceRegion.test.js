// @vitest-environment happy-dom
// The app is aware of where the device IS: new projects start in the country of its time zone / language (offline, no API) and the
// interface follows the device's language unless the user locked one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import App from '../src/App.jsx';
import { detectCurrentRegion, languageFor, regionFromLanguage, regionFromTimeZone } from '../src/lib/geo.js';
import { normalizeSettings } from '../src/lib/draft.js';
import { newProject } from '../src/lib/projects.js';
import { projectStore } from '../src/lib/projectStore.js';
import { REGIONS } from '../src/lib/regions.js';
import { q, flush, click, typeInto, createHost } from './helpers/appHarness.js';
import { resetDevice, setDevice } from './helpers/device.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetDevice());

describe('detectCurrentRegion: time zone first, language second, offline', () => {
  it('maps zones to markets, including whole families and the Atlantic islands', () => {
    expect(regionFromTimeZone('Europe/Rome')).toBe('IT');
    expect(regionFromTimeZone('America/Santiago')).toBe('CL');
    expect(regionFromTimeZone('Europe/Madrid')).toBe('ES');
    expect(regionFromTimeZone('Atlantic/Canary')).toBe('ES');
    expect(regionFromTimeZone('America/Argentina/Salta')).toBe('AR');
    expect(regionFromTimeZone('Europe/Zurich')).toBe('CH');
    expect(regionFromTimeZone('Etc/UTC')).toBeNull();
    expect(regionFromTimeZone('')).toBeNull();
    expect(regionFromTimeZone(undefined)).toBeNull();
    // every mapped country is a market the app really has
    for (const zone of ['Europe/Rome', 'Europe/Kyiv', 'Pacific/Honolulu', 'America/Port_of_Spain']) expect(REGIONS[regionFromTimeZone(zone)]).toBeTruthy();
  });

  it('reads the country of a language tag', () => {
    expect(regionFromLanguage('it-IT')).toBe('IT');
    expect(regionFromLanguage('es_CL')).toBe('CL');
    expect(regionFromLanguage('zh-Hant-TW')).toBeNull(); // not a market of the app
    expect(regionFromLanguage('it')).toBeNull(); // no country in the tag
    expect(regionFromLanguage(null)).toBeNull();
  });

  it('a phone in Italy gives IT even when its language is still Spanish from Chile (where the device IS wins)', () => {
    expect(detectCurrentRegion({ timeZone: 'Europe/Rome', languages: ['it-IT', 'it'] })).toBe('IT');
    expect(detectCurrentRegion({ timeZone: 'Europe/Rome', languages: ['es-CL', 'es'] })).toBe('IT');
    expect(detectCurrentRegion({ timeZone: 'America/Santiago', languages: ['it-IT'] })).toBe('CL');
  });

  it('an unknown zone falls back to the language country; nothing at all is null', () => {
    expect(detectCurrentRegion({ timeZone: 'Asia/Tokyo', languages: ['it-IT'] })).toBe('IT');
    expect(detectCurrentRegion({ timeZone: 'Etc/UTC', languages: ['en', 'fr-BE'] })).toBe('BE');
    expect(detectCurrentRegion({ timeZone: 'Etc/UTC', languages: ['en'] })).toBeNull();
    expect(detectCurrentRegion({ timeZone: '', languages: [] })).toBeNull();
  });

  it('without arguments it reads the device itself (simulated change of time zone and locale)', () => {
    expect(detectCurrentRegion()).toBe('CL');
    setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT', 'it'] });
    expect(detectCurrentRegion()).toBe('IT');
    setDevice({ timeZone: 'Europe/Madrid', languages: ['es-ES'] });
    expect(detectCurrentRegion()).toBe('ES');
  });
});

describe('languageFor + settings: the device language, unless the user locked one', () => {
  it('follows the device language when not locked, keeps the stored one when the device language is not supported', () => {
    expect(languageFor({ lang: 'es' }, { languages: ['it-IT', 'it'] })).toBe('it');
    expect(languageFor({ lang: 'es' }, { languages: ['ja-JP'] })).toBe('es');
    expect(languageFor({ lang: 'es', langLocked: false }, { languages: ['en-US'] })).toBe('en');
  });
  it('an explicitly locked language never changes', () => {
    expect(languageFor({ lang: 'es', langLocked: true }, { languages: ['it-IT'] })).toBe('es');
  });
  it('normalizeSettings stores langLocked only when it is true', () => {
    expect(normalizeSettings({ region: 'CL', lang: 'es' })).toEqual({ region: 'CL', lang: 'es' });
    expect(normalizeSettings({ region: 'CL', lang: 'es', langLocked: true })).toEqual({ region: 'CL', lang: 'es', langLocked: true });
    expect(normalizeSettings({ region: 'CL', lang: 'es', langLocked: 'yes' })).toEqual({ region: 'CL', lang: 'es' });
  });
});

describe('ProjectSheet: the market of a new project starts where the device is', () => {
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
  const open = async (props = {}, lang = 'es') => {
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(ProjectSheet, { onSave: props.onSave || (() => {}), onClose: () => {}, ...props })));
    });
  };
  const marketInput = () => qs('project-market').querySelector('input[role="combobox"]');

  it('in Italy the combobox is already 🇮🇹 Italia with EUR, and the saved project is IT (not the stored Chile)', async () => {
    setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT'] });
    const saved = [];
    await open({ defaultRegion: 'CL', onSave: (f) => saved.push(f) });
    expect(marketInput().value).toBe('🇮🇹 Italia');
    expect(qs('project-market-hint').textContent).toContain('EUR');
    await click(qs('project-save'));
    expect(saved[0].regionCode).toBe('IT');
  });

  it('in Chile it starts as Chile; on a device that says nothing it uses the stored default; the user can still change it', async () => {
    const saved = [];
    await open({ defaultRegion: 'PE', onSave: (f) => saved.push(f) });
    expect(marketInput().value).toBe('🇨🇱 Chile');
    act(() => root.unmount());
    root = createRoot(host);
    setDevice({ timeZone: 'Etc/UTC', languages: ['en'] });
    await open({ defaultRegion: 'PE', onSave: (f) => saved.push(f) });
    expect(marketInput().value).toBe('🇵🇪 Perú');
    await click(marketInput()); // opens the list
    await click(document.querySelector('[role="option"][id$="-opt-DE"]'));
    expect(marketInput().value).toContain('Alemania');
    await click(qs('project-save'));
    expect(saved.at(-1).regionCode).toBe('DE');
  });

  it('a device with no hint and no stored default sends no market (the app keeps its own); editing a project shows ITS market (changeable)', async () => {
    setDevice({ timeZone: 'Etc/UTC', languages: ['en'] });
    const saved = [];
    await open({ onSave: (f) => saved.push(f) });
    await click(qs('project-save'));
    expect(saved[0]).not.toHaveProperty('regionCode');
    act(() => root.unmount());
    root = createRoot(host);
    await open({ project: newProject({ regionCode: 'CL', name: 'Obra' }), onDelete: () => {} });
    expect(qs('project-market').querySelector('input[role="combobox"]').value).toBe('🇨🇱 Chile');
  });
});

describe('App: the interface and the new projects follow the device', () => {
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

  it('an Italian phone in Italy: the UI switches to Italian by itself and a new project is IT / EUR', async () => {
    seed({ region: 'CL', lang: 'es' }); // leftovers of earlier tests in Chile / Spanish, never locked
    setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT', 'it'] });
    h = createHost(App);
    await h.mount();
    expect(h.tab('Impostazioni')).toBeTruthy(); // Italian navigation
    expect(document.documentElement.lang).toBe('it');
    expect(JSON.parse(localStorage.getItem('cp.settings.v1'))).toEqual({ region: 'CL', lang: 'it' }); // not locked: it keeps following the device
    await click(q('fab-new'));
    expect(document.querySelector('[data-testid="project-market"] input').value).toBe('🇮🇹 Italia');
    await typeInto(document.querySelector('[role="dialog"] input'), 'Casa Rossi');
    await click(q('project-save'));
    await flush(400);
    const [project] = await projectStore.load();
    expect(project.draft.regionCode).toBe('IT');
  });

  it('a language the user locked is respected, whatever the phone says', async () => {
    seed({ region: 'CL', lang: 'es', langLocked: true });
    setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT'] });
    h = createHost(App);
    await h.mount();
    expect(h.tab('Ajustes')).toBeTruthy();
    expect(document.documentElement.lang).toBe('es');
  });

  it('choosing a language in the settings locks it for good (the phone language stops overriding it)', async () => {
    seed({ region: 'CL', lang: 'es' });
    setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT'] });
    h = createHost(App);
    await h.mount();
    await click(h.tab('Impostazioni'));
    const select = q('settings-lang').querySelector('select');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'de');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(50);
    expect(JSON.parse(localStorage.getItem('cp.settings.v1'))).toMatchObject({ lang: 'de', langLocked: true });
    h.unmount();
    h = createHost(App);
    await h.mount();
    expect(document.documentElement.lang).toBe('de');
  });

  it('the system language changing while the app is open is followed (unless locked)', async () => {
    seed({ region: 'CL', lang: 'es' });
    h = createHost(App);
    await h.mount();
    expect(document.documentElement.lang).toBe('es');
    setDevice({ timeZone: 'Europe/Paris', languages: ['fr-FR'] });
    await act(async () => {
      window.dispatchEvent(new Event('languagechange'));
    });
    await flush(30);
    expect(document.documentElement.lang).toBe('fr');
  });
});
