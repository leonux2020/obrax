// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import App from '../src/App.jsx';
import ProfileSetup from '../src/components/ProfileSetup.jsx';
import BottomNav from '../src/components/BottomNav.jsx';
import { EMPTY_COMPANY, loadCompany, loadProfileMeta, loadUser, normalizeCompany, normalizeProfileMeta, isCompanyEmpty } from '../src/lib/draft.js';
import { buildClientModel } from '../src/lib/reports.js';
import { computeAll } from '../src/lib/engine.js';
import { newDraft } from '../src/lib/draft.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

let host;
let root;
const mountApp = async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 30));
  });
};
const unmount = () => {
  act(() => root.unmount());
  host.remove();
};
const q = (id) => host.querySelector(`[data-testid="${id}"]`) || document.querySelector(`[data-testid="${id}"]`);
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
function type(input, value) {
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const inputByLabel = (root_, text) => {
  const label = [...root_.querySelectorAll('label')].find((l) => l.textContent.startsWith(text));
  return root_.querySelector(`#${CSS.escape(label.htmlFor)}`);
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  if (host?.isConnected) unmount();
});

describe('first run: splash -> setup -> dashboard', () => {
  it('a brand-new install shows ONLY the logo, the app name and one bottom button', async () => {
    await mountApp();
    expect(q('splash')).not.toBeNull();
    expect(host.querySelector('h1').textContent).toBe('Obrax');
    expect(host.querySelector('img')).not.toBeNull();
    const buttons = host.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Configurar mi Empresa');
    expect(buttons[0].closest('.fixed').className).toContain('bottom-0'); // bottom third, thumb zone
    expect(host.querySelector('header')).toBeNull(); // no app chrome around the splash
  });

  it('full flow: country -> company + professional + Drive switch -> "Guardar y Entrar" -> Dashboard, and the splash never returns', async () => {
    await mountApp();
    await click(q('splash-start'));
    // no country saved yet: the country picker comes first
    const combo = host.querySelector('[role="combobox"]');
    act(() => combo.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const chile = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Chile'));
    await click(chile);
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === DICT.es['region.continue']));

    expect(q('setup')).not.toBeNull();
    const main = q('setup');
    for (const label of ['Empresa', 'Profesional']) expect([...main.querySelectorAll('h2')].map((h) => h.textContent)).toContain(label);
    const drive = q('setup-drive');
    expect(drive.getAttribute('role')).toBe('switch');
    expect(drive.getAttribute('aria-checked')).toBe('true');
    expect(drive.textContent).toContain('Respaldo en Google Drive (Gratis)');
    await click(drive);
    expect(drive.getAttribute('aria-checked')).toBe('false');
    expect(q('setup-save').textContent).toBe('Guardar y Entrar');

    // nothing to save yet -> a friendly error, still on setup
    await click(q('setup-save'));
    expect(q('setup-error').textContent).toBe(DICT.es['setup.required']);
    expect(q('setup')).not.toBeNull();

    type(inputByLabel(main, 'Nombre'), 'Constructora Aurora SpA'); // company name field is the first "Nombre ..." label
    type(inputByLabel(main, 'RUT'), '76.123.456-7');
    type(inputByLabel(main, 'Nombre del profesional'), 'Ana Ruiz');
    type(inputByLabel(main, 'ID personal'), '12.345.678-5');
    await click(q('setup-save'));
    await flush(80);

    // lands on the dashboard
    expect(q('splash')).toBeNull();
    expect(q('setup')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();
    expect(q('pro-scan')).not.toBeNull();

    // persisted
    const company = loadCompany();
    expect(company).toMatchObject({ name: 'Constructora Aurora SpA', taxId: '76.123.456-7', proName: 'Ana Ruiz', proTaxId: '12.345.678-5' });
    expect(loadProfileMeta()).toEqual({ onboarded: true, drive: false });
    expect(loadUser()).toMatchObject({ provider: 'local', name: 'Ana Ruiz' });

    // relaunch: straight to the dashboard
    unmount();
    await mountApp();
    expect(q('splash')).toBeNull();
    expect(q('setup')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();
  });
});

describe('after onboarding, the profile lives only in Ajustes', () => {
  async function onboarded() {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana Ruiz' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', taxId: '76.123.456-7', proName: 'Ana Ruiz', proTaxId: '1-9' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    await mountApp();
  }
  const tab = (name) => [...host.querySelectorAll('nav button')].find((b) => b.textContent.includes(name));

  it('the bottom nav has Proyectos / Ajustes / Nuevo: no "Empresa" shortcut', async () => {
    await onboarded();
    expect(q('splash')).toBeNull();
    const labels = [...host.querySelectorAll('nav button')].map((b) => b.textContent.trim());
    expect(labels).toEqual(['Proyectos', 'Ajustes', 'Nuevo']);
    expect(read('components/BottomNav.jsx')).not.toContain('onCompany');
  });

  it('Ajustes shows the profile and is the only way to edit it', async () => {
    await onboarded();
    await click(tab('Ajustes'));
    expect(q('settings-profile').textContent).toContain('Aurora');
    await click(q('settings-edit-profile'));
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.textContent).toContain('Empresa y profesional');
    expect(inputByLabel(sheet, 'Nombre del profesional').value).toBe('Ana Ruiz');
    type(inputByLabel(sheet, 'Nombre del profesional'), 'Ana Ruiz Soto');
    await click(q('profile-save'));
    await flush(80);
    // back in Ajustes with the new data
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Aurora');
    expect(loadCompany().proName).toBe('Ana Ruiz Soto');
    expect(loadProfileMeta().onboarded).toBe(true);
  });

  it('nothing else can open the profile editor', () => {
    for (const f of ['components/Dashboard.jsx', 'components/BottomNav.jsx', 'components/steps/StepReport.jsx', 'components/Wizard.jsx']) {
      expect(read(f), f).not.toMatch(/ProfileSheet|onCompany|onEditCompany/);
    }
    expect(read('App.jsx')).toMatch(/onEditProfile=\{\(\) => setSheet\(\{ type: 'profile' \}\)\}/);
  });

  it('a user who has an empty company profile (legacy) goes to Ajustes from the dashboard hint, not to a splash', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    await mountApp();
    expect(q('splash')).toBeNull();
    const hint = q('company-hint');
    expect(hint).not.toBeNull();
    await click(hint.querySelector('button'));
    expect(document.querySelector('[role="dialog"]').textContent).toContain('Idioma');
  });
});

describe('PRO button and benefits screen', () => {
  const setup = async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    await mountApp();
  };

  it('"Descubre PRO": gold outline, helmet icon, no crown, no fill', async () => {
    await setup();
    const pro = q('pro-scan');
    expect(pro.textContent.trim()).toBe('Descubre PRO');
    expect(pro.textContent).not.toContain('👑');
    expect(pro.querySelector('svg[data-testid="helmet-icon"]')).not.toBeNull();
    expect(pro.className).toMatch(/border-\[#d4af37\]/);
    expect(pro.className).not.toMatch(/\bbg-/);
  });

  it('the hard hat is big, gold-gradient and has the crest and the curved visor', async () => {
    await setup();
    const svg = q('pro-scan').querySelector('svg[data-testid="helmet-icon"]');
    expect(Number(svg.getAttribute('width'))).toBeGreaterThanOrEqual(24); // w-6 or larger, the protagonist of the button
    expect(Number(svg.getAttribute('width'))).toBe(Number(svg.getAttribute('height')));
    const grads = [...svg.querySelectorAll('linearGradient')];
    expect(grads.length).toBeGreaterThanOrEqual(1);
    const stops = [...grads[0].querySelectorAll('stop')].map((s) => s.getAttribute('stop-color').toUpperCase());
    expect(stops).toContain('#FBBF24');
    expect(stops).toContain('#D97706');
    // every gradient id is unique and the fills reference them (no flat single-colour body)
    const ids = grads.map((g) => g.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
    for (const part of ['shell', 'crest', 'visor']) {
      const el = svg.querySelector(`[data-part="${part}"]`);
      expect(el, part).not.toBeNull();
      expect(el.getAttribute('fill')).toMatch(/^url\(#/);
    }
    expect(svg.querySelector('[data-part="shine"]')).not.toBeNull();
    // the visor is wider than the shell (it projects past it) and sits below it
    expect(svg.querySelector('[data-part="visor"]').getAttribute('d')).toMatch(/^M2 /);
  });

  it('two helmets on screen never share gradient ids', async () => {
    await setup();
    await click(q('pro-scan'));
    const ids = [...document.querySelectorAll('svg[data-testid="helmet-icon"] linearGradient')].map((g) => g.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tapping it opens the benefits screen (no toast) with 3 benefits, 2 plans and an inactive Subscribe', async () => {
    await setup();
    expect(q('pro-paywall')).toBeNull();
    await click(q('pro-scan'));
    const wall = q('pro-paywall');
    expect(wall).not.toBeNull();
    expect(q('toast')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.className).toContain('bg-black');
    const items = [...q('pro-benefits').querySelectorAll('li p:first-child')].map((p) => p.textContent);
    expect(items).toEqual(['Respaldo automático en Google Drive', 'Lectura de facturas con IA', 'Sin límites de proyectos']);
    expect(q('pro-plan-monthly').textContent).toContain('Mensual');
    expect(q('pro-plan-yearly').textContent).toContain('Anual');
    expect(q('pro-plan-yearly').getAttribute('aria-checked')).toBe('true');
    await click(q('pro-plan-monthly'));
    expect(q('pro-plan-monthly').getAttribute('aria-checked')).toBe('true');
    expect(q('pro-plan-yearly').getAttribute('aria-checked')).toBe('false');
    const sub = q('pro-subscribe');
    expect(sub.textContent).toBe('Suscribirse');
    expect(sub.disabled).toBe(true);
    await click(sub); // inert
    expect(q('pro-paywall')).not.toBeNull();
    expect(q('pro-note').textContent).toContain('ningún cobro');
  });

  it('there is always a way out: Volver, the × button and Escape', async () => {
    await setup();
    await click(q('pro-scan'));
    expect(q('pro-back').textContent).toBe('Volver');
    await click(q('pro-back'));
    expect(q('pro-paywall')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();

    await click(q('pro-scan'));
    await click(document.querySelector('[data-sheet-close]'));
    expect(q('pro-paywall')).toBeNull();

    await click(q('pro-scan'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q('pro-paywall')).toBeNull();
  });

  it('the temporary toast is gone', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/components/Toast.jsx'))).toBe(false);
    expect(read('components/Dashboard.jsx')).not.toMatch(/Toast|setToast/);
    for (const l of LANGS) expect(DICT[l]['pro.soon']).toBeUndefined();
  });

  it('pure black, thin borders, no grey fills', () => {
    for (const f of ['ProPaywall', 'HelmetIcon']) expect(read(`components/${f}.jsx`), f).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
    expect(read('components/ProPaywall.jsx')).toContain('border-white/10');
    expect(read('components/ProPaywall.jsx')).toContain('bg-black');
  });

  it('paywall strings exist in six languages with the agreed Spanish wording', () => {
    const keys = ['pro.cta', 'pro.title', 'pro.subtitle', 'pro.benefits', 'pro.b.drive', 'pro.b.ai', 'pro.b.projects', 'pro.plan.monthly', 'pro.plan.yearly', 'pro.price.monthly', 'pro.price.yearly', 'pro.subscribe', 'pro.back', 'pro.note'];
    for (const l of LANGS) for (const k of keys) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
    expect(DICT.es['pro.cta']).toBe('Descubre PRO');
    expect(DICT.es['pro.back']).toBe('Volver');
  });
});

describe('data model and copy', () => {
  it('professional fields are sanitized; the splash flag defaults to false and tolerates junk', () => {
    const c = normalizeCompany({ name: 'A', proName: '<b>Ana</b> Ruiz', proTaxId: "1-9'; DROP" });
    expect(c.proName).not.toMatch(/[<>]/);
    expect(c.proTaxId).toMatch(/^[A-Z0-9.\-/]*$/);
    expect(Object.keys(EMPTY_COMPANY)).toEqual(['name', 'taxId', 'phone', 'email', 'city', 'proName', 'proTaxId']);
    expect(isCompanyEmpty(normalizeCompany({ proName: 'Ana' }))).toBe(false);
    expect(normalizeProfileMeta(null)).toEqual({ onboarded: false, drive: true });
    expect(normalizeProfileMeta({ onboarded: 'yes', drive: false })).toEqual({ onboarded: false, drive: false });
  });

  it('the contractor signature line names the professional when there is one', () => {
    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const i = makeI18n('es', 'CL');
    const result = computeAll(d, 1_700_000_000_000);
    const base = { draft: d, result, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
    const withPro = buildClientModel({ ...base, company: { name: 'Aurora', taxId: '76.1', proName: 'Ana Ruiz', proTaxId: '12.345.678-5' } });
    expect(withPro.signCompanyData).toEqual(['Ana Ruiz', 'RUT: 12.345.678-5']);
    const only = buildClientModel({ ...base, company: { name: 'Aurora', taxId: '76.1' } });
    expect(only.signCompanyData).toEqual(['Aurora', 'RUT: 76.1']);
  });

  it('all new strings exist in six languages and the Spanish wording is the agreed one', () => {
    for (const l of LANGS) for (const k of ['setup.cta', 'setup.save', 'setup.drive', 'setup.pro.name', 'settings.profile.edit']) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
    expect(DICT.es['setup.cta']).toBe('Configurar mi Empresa');
    expect(DICT.es['setup.drive']).toBe('Respaldo en Google Drive (Gratis)');
    expect(DICT.es['setup.save']).toBe('Guardar y Entrar');
  });

  it('OLED: the new screens use pure black, thin borders and no grey fills', () => {
    for (const f of ['SplashScreen', 'ProfileSetup', 'ProfileFields', 'ProfileSheet']) {
      const text = read(`components/${f}.jsx`);
      expect(text, f).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
    }
    expect(read('components/ProfileSetup.jsx')).toContain('border-white/10');
  });
});
