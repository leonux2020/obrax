// @vitest-environment happy-dom
// Fase 11.2: Lingua e Paese and Operazioni e Sincronizzazione as flat native-menu rows (icon, title, dim subtitle, accent value), pickers in
// bottom sheets. (The signature lock / smoothing and the professional ID are covered in profileCard.test.js.)
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLIENT, q, flush, click, createHost, deviceBack } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { LocaleRows } from '../src/components/SettingsRows.jsx';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de'];

let App;
let h;
beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  window.history.replaceState(null, '');
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'IT', lang: 'it', langLocked: true }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
});
afterEach(() => h?.unmount());

const open = async (id) => {
  const d = q(id);
  d.open = true;
  await act(async () => {
    d.dispatchEvent(new Event('toggle'));
  });
  await flush(10);
};
const mount = async () => {
  h = createHost(App);
  await h.mount();
  await click(q('nav-settings'));
};

describe('Lingua e Paese: two clean rows', () => {
  it('icon on the left, title, the current value on the right in text-brand/90; no select, no input, no box, no border', async () => {
    await mount();
    await open('settings-locale');
    const body = q('settings-locale');
    for (const [row, value, text] of [['settings-lang', 'settings-lang-value', 'Italiano'], ['settings-region', 'settings-region-value', /Ital/]]) {
      const r = q(row);
      expect(r.tagName).toBe('BUTTON');
      expect(r.querySelector('svg[data-outline-icon="true"]')).not.toBeNull();
      expect(r.firstElementChild.className).toContain('text-neutral-400'); // the quiet icon is the first thing of the row
      expect(q(value).className).toContain('text-brand/90');
      if (typeof text === 'string') expect(q(value).textContent).toBe(text);
      else expect(q(value).textContent).toMatch(text);
      expect(r.className).not.toMatch(/\bborder|\bcard\b|bg-(?!transparent)/);
    }
    expect(q('settings-lang').textContent).toContain('Lingua');
    expect(body.querySelector('select, input, [role="combobox"]')).toBeNull();
    expect(q('settings-lang').compareDocumentPosition(q('settings-region')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('tapping the language row opens a black sheet with the six languages; the current one is marked; Back closes only the sheet', async () => {
    await mount();
    await open('settings-locale');
    await click(q('settings-lang'));
    const sheet = q('settings-lang-sheet');
    expect(sheet).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    for (const l of LANGS) expect(q(`lang-option-${l}`), l).not.toBeNull();
    expect(q('lang-option-it').getAttribute('aria-selected')).toBe('true');
    expect(q('lang-option-it').className).toContain('text-brand/90');
    expect(q('lang-option-de').getAttribute('aria-selected')).toBe('false');
    expect(sheet.innerHTML).not.toMatch(/bg-neutral|bg-gray|<select/);
    await deviceBack();
    expect(q('settings-lang-sheet')).toBeNull();
    expect(q('settings-locale').open).toBe(true); // the accordion stays as it was
    expect(q('settings-view')).not.toBeNull();
  });

  it('picking a language applies it in place and closes the sheet; the row shows the new value', async () => {
    await mount();
    await open('settings-locale');
    await click(q('settings-lang'));
    await click(q('lang-option-de'));
    await flush(60);
    expect(q('settings-lang-sheet')).toBeNull();
    expect(q('settings-title').textContent).toBe('Einstellungen');
    expect(q('settings-lang-value').textContent).toBe('Deutsch');
  });

  it('the country row opens a searchable list; picking calls onConfirmRegion with the code and closes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const picked = [];
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'it', regionCode: 'IT' }, React.createElement(LocaleRows, { regionCode: 'IT', onChangeLang: () => {}, onConfirmRegion: (c) => picked.push(c) })));
    });
    expect(q('settings-region-value').textContent).toContain('Italia');
    await click(q('settings-region'));
    expect(q('settings-region-sheet')).not.toBeNull();
    expect(q('region-option-IT').getAttribute('aria-selected')).toBe('true');
    // search filters
    await act(async () => {
      const input = q('region-search');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'chile');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(q('region-option-CL')).not.toBeNull();
    expect(q('region-option-IT')).toBeNull();
    await click(q('region-option-CL'));
    expect(picked).toEqual(['CL']);
    expect(q('settings-region-sheet')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it('source: the old select / combobox boxes are no longer used by Ajustes', () => {
    const view = readFileSync('src/components/SettingsView.jsx', 'utf8');
    expect(view).not.toMatch(/LangSelect|RegionCombobox/);
    expect(view).toMatch(/<LocaleRows/);
  });
});

describe('Operazioni e Sincronizzazione: a flat list, no heavy blocks', () => {
  it('no rule, divider or border between the rows of the card body; icons text-neutral-400; the subtitle is text-sm and dim', async () => {
    await mount();
    await open('settings-ops');
    const cloud = q('settings-cloud');
    const classes = [cloud, ...cloud.querySelectorAll('*')].map((el) => String(el.getAttribute('class') || ''));
    // (the toggle's own track is a control, not a separator)
    const offenders = [cloud, ...cloud.querySelectorAll('*')].filter((el) => /(^|\s)(border-t|border-b|divide-y|divide-white)/.test(String(el.getAttribute('class') || '')));
    expect(offenders.map((e) => e.tagName + '.' + e.className)).toEqual([]);
    expect(q('settings-ops').querySelector(':scope > div').className).not.toContain('divide-');
    expect(cloud.querySelector('svg[data-outline-icon="true"]').getAttribute('class')).toContain('text-neutral-400');
    expect(q('settings-drive').textContent).toContain('Sincronizza con Google Drive');
    const sub = [...q('settings-drive').querySelectorAll('span')].find((s) => s.textContent === 'Copia automatica dei tuoi progetti');
    expect(sub.className).toContain('text-sm');
    expect(sub.className).toMatch(/text-neutral-(400|500)/);
    expect(classes.length).toBeGreaterThan(3);
    expect(q('settings-drive').getAttribute('role')).toBe('switch');
  });

  it('the drive title uses the same light type as the rest of Ajustes', async () => {
    await mount();
    await open('settings-ops');
    expect(q('settings-drive').querySelector('span[id$="-l"]').className).toContain('font-light');
  });
});

describe('copy in six languages', () => {
  it('country row title, drive subtitle and the signature unlock text exist everywhere; Italian reads "Tocca per sbloccare e firmare"', () => {
    for (const l of LANGS) for (const k of ['settings.country', 'settings.driveSync.sub', 'profile.sign.unlock']) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
    expect(DICT.it['profile.sign.unlock']).toBe('Tocca per sbloccare e firmare');
    expect(DICT.it['settings.country']).toBe('Paese');
  });
});
