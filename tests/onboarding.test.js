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
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
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
  it('a brand-new install shows ONLY the logo, one "Iniciar" button and "Un producto Japadigital"', async () => {
    await mountApp();
    expect(q('splash')).not.toBeNull();
    expect(host.querySelector('img')).not.toBeNull();
    // "Iniciar" + the "Instalar App" button (hidden once installed), both in the bottom third (thumb zone)
    const buttons = [...host.querySelectorAll('button')].filter((b) => b.dataset.testid !== 'install-app');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Iniciar');
    expect(buttons[0].closest('.fixed').className).toContain('bottom-0');
    expect(q('install-app').closest('.fixed').className).toContain('bottom-0');
    expect(q('splash-credit').textContent).toBe('Un producto Japadigital');
    const name = host.querySelector('h1');
    expect(name.textContent).toBe('CUBRAX'); // the name sits centred right under the logo
    expect(name.className).toContain('text-center');
    expect(host.querySelector('img').compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll('p')).toHaveLength(1); // no tagline, no extra text
    expect(host.querySelector('header')).toBeNull(); // no app chrome around the splash
  });

  it('full flow: Iniciar -> ONE setup screen (country detected silently, company, signature canvas, Drive request) -> Continuar -> Dashboard', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['es-CL', 'es'], configurable: true });
    await mountApp();
    await click(q('splash-start'));
    // the country was NOT asked: it comes from the device and is shown as a chip
    expect(host.querySelector('[role="combobox"]')).toBeNull();
    expect(q('setup')).not.toBeNull();
    expect(q('setup-region').textContent).toContain('Chile');
    expect(q('setup-currency').textContent).toBe('CLP');
    expect(JSON.parse(localStorage.getItem('cp.settings.v1'))).toMatchObject({ region: 'CL', lang: 'es' });

    const main = q('setup');
    for (const label of ['Empresa', 'Profesional', 'Firma digital']) expect([...main.querySelectorAll('h2')].map((h) => h.textContent)).toContain(label);
    expect(main.querySelector('[data-testid="signature-canvas"]')).not.toBeNull(); // the canvas lives on this very screen
    // Google Drive: the request goes through Google's own consent; there is no password field anywhere
    expect(q('setup-drive').textContent).toBe('Conectar Google Drive');
    expect(main.querySelector('input[type="password"]')).toBeNull();
    await click(q('setup-drive')); // no client id in tests: the OAuth flow reports it, nothing breaks
    expect(q('setup-drive-note').getAttribute('data-code')).toBe('not_configured');
    expect(q('setup-save').textContent).toBe('Continuar');
    expect(q('setup-save').closest('.fixed').className).toContain('bottom-0');

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
    expect(loadProfileMeta()).toEqual({ onboarded: true, drive: false }); // Drive stays off until Google confirms
    expect(loadUser()).toMatchObject({ provider: 'local', name: 'Ana Ruiz' });

    // relaunch: straight to the dashboard
    unmount();
    await mountApp();
    expect(q('splash')).toBeNull();
    expect(q('setup')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();
    delete navigator.languages;
  });

  it('when the device gives no country hint the picker still appears (the only question left)', async () => {
    Object.defineProperty(navigator, 'languages', { value: ['en'], configurable: true });
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = () => ({ timeZone: 'Etc/UTC', locale: 'en' });
    try {
      await mountApp();
      await click(q('splash-start'));
      expect(host.querySelector('[role="combobox"]')).not.toBeNull();
      expect(q('setup')).toBeNull();
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = original;
      delete navigator.languages;
    }
  });

  it('the Google Drive request records the consent only when Google confirms it (injected OAuth)', async () => {
    const saved = [];
    const h = document.createElement('div');
    document.body.appendChild(h);
    const r = createRoot(h);
    await act(async () => {
      r.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ProfileSetup, { onSave: async (d) => saved.push(d), requestDrive: async () => ({ granted: true }) })));
    });
    const btn = h.querySelector('[data-testid="setup-drive"]');
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((x) => setTimeout(x, 5)); });
    expect(btn.textContent).toContain('Google Drive conectado');
    type(h.querySelector('input[type="text"]'), 'Aurora');
    await act(async () => { h.querySelector('[data-testid="setup-save"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((x) => setTimeout(x, 20)); });
    expect(saved).toHaveLength(1);
    expect(saved[0].drive).toBe(true);
    act(() => r.unmount());
    h.remove();
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

  it('the bottom nav has Proyectos / Contabilidad Global / Ajustes: no "Empresa" shortcut and no "Nuevo" (that is the FAB)', async () => {
    await onboarded();
    expect(q('splash')).toBeNull();
    const labels = [...host.querySelectorAll('nav button')].map((b) => b.textContent.trim());
    expect(labels).toEqual(['Proyectos', 'Contabilidad Global', 'Ajustes']);
    expect(q('fab-new')).not.toBeNull();
    expect(read('components/BottomNav.jsx')).not.toContain('onCompany');
  });

  it('Ajustes shows the profile and is the only way to edit it (inline, autosave)', async () => {
    await onboarded();
    await click(tab('Ajustes'));
    expect(q('settings-profile')).not.toBeNull();
    expect(q('settings-edit-profile')).toBeNull(); // no competing "Editar" / modal
    expect(q('settings-company-name').value).toBe('Aurora');
    expect(q('settings-pro-name').value).toBe('Ana Ruiz');
    expect(q('settings-company-tax')).not.toBeNull();
    expect(q('settings-company-city')).not.toBeNull();
    expect(q('settings-signature').textContent).toContain('Configurar Firma Digital');
    type(q('settings-pro-name'), 'Ana Ruiz Soto');
    await flush(400); // debounced autosave
    expect(q('settings-pro-name').value).toBe('Ana Ruiz Soto');
    expect(loadCompany().proName).toBe('Ana Ruiz Soto');
    expect(loadProfileMeta().onboarded).toBe(true);
    expect(q('settings-saved').textContent).toContain('Guardado');
  });

  it('nothing else can open a profile editor modal', () => {
    for (const f of ['components/Dashboard.jsx', 'components/BottomNav.jsx', 'components/steps/StepReport.jsx', 'components/Wizard.jsx', 'App.jsx']) {
      expect(read(f), f).not.toMatch(/onEditProfile|setSheet\(\{ type: 'profile'/);
    }
  });

  it('a user who has an empty company profile (legacy) lands on the dashboard, not on a splash, and reaches Ajustes from the nav', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    await mountApp();
    expect(q('splash')).toBeNull();
    expect(q('company-hint')).toBeNull(); // no long hint text any more
    await click(tab('Ajustes'));
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

  it('the PRO mark is a discreet badge in the header (no big button, no long text)', async () => {
    await setup();
    const pro = q('pro-scan');
    expect(pro.textContent.trim()).toBe('PRO');
    expect(pro.getAttribute('aria-label')).toBe('Descubre PRO');
    expect(pro.closest('header')).not.toBeNull();
    expect(pro.className).not.toMatch(/\bbg-/);
    expect(pro.className).not.toMatch(/min-h-\[56px\]/);
  });

  it('the hard hat is a 3/4 gold-gradient site-manager helmet: front-only short visor, smooth flank, low thin crest, top-left light', async () => {
    await setup();
    await click(q('pro-scan'));
    const svg = document.querySelector('svg[data-testid="helmet-icon"]');
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
    // 3/4 view: the whole hat is tilted on the diagonal
    expect(svg.querySelector('[data-part="tilt"]').getAttribute('transform')).toMatch(/^rotate\(-?\d+/);
    // geometry helpers (shell and crest use absolute commands only)
    const ys = (part) => (svg.querySelector(`[data-part="${part}"]`).getAttribute('d').match(/-?\d*\.?\d+/g) || []).map(Number).filter((_, i) => i % 2 === 1);
    const xs = (part) => (svg.querySelector(`[data-part="${part}"]`).getAttribute('d').match(/-?\d*\.?\d+/g) || []).map(Number).filter((_, i) => i % 2 === 0);
    // crest: low and thin - it protrudes at most ~1.5 units above the dome apex and is a thin band (<= 5.5 tall in total)
    const crestTop = Math.min(...ys('crest'));
    const shellTop = Math.min(...ys('shell'));
    expect(shellTop - crestTop).toBeGreaterThan(0.3);
    expect(shellTop - crestTop).toBeLessThanOrEqual(1.5);
    expect(Math.max(...ys('crest')) - crestTop).toBeLessThanOrEqual(5.5);
    // the crest never reaches the dome's flanks: it stays within the upper part of the shell
    expect(Math.max(...ys('crest'))).toBeLessThan(shellTop + 6);
    // modern cap-style hat: ONE short visor, only at the front (left in this 3/4 view) - no brim around the shell
    const shellMin = Math.min(...xs('shell'));
    const shellMax = Math.max(...xs('shell'));
    const shellW = shellMax - shellMin;
    const visorMin = Math.min(...xs('visor'));
    const visorMax = Math.max(...xs('visor'));
    expect(visorMin).toBeLessThan(shellMin); // it projects forward past the dome
    expect(shellMin - visorMin).toBeLessThanOrEqual(4.5); // ...but it is short
    expect(visorMax).toBeLessThan(shellMin + shellW * 0.5); // never reaches the rear half: no side/back wing
    expect(svg.querySelectorAll('[data-part="visor"]')).toHaveLength(1);
    expect(Math.max(...ys('visor'))).toBeLessThanOrEqual(Math.max(...ys('shell')) + 3); // does not hang far below the dome
    // the left flank is smooth: nothing is drawn over the shell besides the crest and the highlight
    const drawn = [...svg.querySelectorAll('g[data-part="tilt"] > path')].map((el) => el.getAttribute('data-part') || (el.getAttribute('fill')?.startsWith('url') ? 'shade' : 'line'));
    expect(drawn).toEqual(['visor', 'shell', 'shade', 'crest', 'shine']);
    // light from the front/upper-left: the body gradient runs top-left -> bottom-right, lightest stop first
    const g = grads.find((x) => svg.querySelector('[data-part="shell"]').getAttribute('fill').includes(x.id));
    expect(Number(g.getAttribute('x2'))).toBeGreaterThan(Number(g.getAttribute('x1')));
    expect(Number(g.getAttribute('y2'))).toBeGreaterThan(Number(g.getAttribute('y1')));
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255); };
    const stopColors = [...g.querySelectorAll('stop')].map((st) => st.getAttribute('stop-color'));
    expect(lum(stopColors[0])).toBeGreaterThan(lum(stopColors[stopColors.length - 1]));
    // no drop shadows / filters: volume comes from gradients alone, on the bare OLED background
    expect(svg.querySelector('filter')).toBeNull();
    expect(read('components/HelmetIcon.jsx')).not.toMatch(/<filter|drop-shadow|feGaussianBlur/);
  });

  it('the gradient ids of the hard hat are unique', async () => {
    await setup();
    await click(q('pro-scan'));
    const ids = [...document.querySelectorAll('svg[data-testid="helmet-icon"] linearGradient')].map((g) => g.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tapping it opens the benefits screen (no toast) with 2 PRO benefits, 3 plans and an inactive Subscribe', async () => {
    await setup();
    expect(q('pro-paywall')).toBeNull();
    await click(q('pro-scan'));
    const wall = q('pro-paywall');
    expect(wall).not.toBeNull();
    expect(q('toast')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.className).toContain('bg-black');
    const items = [...q('pro-benefits').querySelectorAll('li p:first-child')].map((p) => p.textContent);
    expect(items).toEqual(['Lectura de facturas con IA', 'Sin límites de proyectos']); // Drive backup is FREE now
    expect(wall.textContent).not.toContain('Google Drive');
    expect(q('pro-plan-monthly').textContent).toContain('Mensual');
    expect(q('pro-plan-yearly').textContent).toContain('Anual');
    expect(q('pro-plan-biennial').textContent).toContain('2 años');
    expect(q('pro-plan-biennial').textContent).toContain('$79.99');
    // the yearly plan is in the middle, is the featured one ("most popular", taller, gold edge) and is selected by default
    const order = [...wall.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('data-testid'));
    expect(order).toEqual(['pro-plan-monthly', 'pro-plan-yearly', 'pro-plan-biennial']);
    expect(q('pro-plan-yearly').getAttribute('data-featured')).toBe('true');
    expect(q('pro-plan-monthly').getAttribute('data-featured')).toBeNull();
    expect(q('pro-plan-biennial').getAttribute('data-featured')).toBeNull();
    expect(q('pro-plan-yearly').textContent).toContain('Más popular');
    expect(q('pro-plan-yearly').textContent).toContain('Ahorra 33 %');
    expect(q('pro-plan-yearly').className).toMatch(/min-h-\[104px\]/);
    expect(q('pro-plan-biennial').className).toMatch(/min-h-\[72px\]/);
    // contrast: the 2-year plan costs the same per month as the yearly one but asks for twice the commitment
    expect(q('pro-plan-yearly').textContent).toContain('$3.33');
    expect(q('pro-plan-biennial').textContent).toContain('$3.33');
    expect(q('pro-plan-biennial').textContent).not.toContain('Ahorra');
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
    const keys = ['pro.cta', 'pro.title', 'pro.subtitle', 'pro.benefits', 'pro.b.ai', 'pro.b.projects', 'pro.plan.monthly', 'pro.plan.yearly', 'pro.plan.biennial', 'pro.price.monthly', 'pro.price.yearly', 'pro.price.biennial', 'pro.plan.popular', 'pro.permonth', 'pro.subscribe', 'pro.back', 'pro.note'];
    for (const l of LANGS) expect(DICT[l]['pro.b.drive'], l).toBeUndefined();
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
    expect(Object.keys(EMPTY_COMPANY)).toEqual(['name', 'taxId', 'phone', 'email', 'city', 'proName', 'proTaxId', 'signature']);
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
