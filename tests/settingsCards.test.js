// @vitest-environment happy-dom
// Ajustes as three OLED cards: Perfil de Empresa (editable + email/phone), Idioma y País side by side, Google Drive command centre.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { CLIENT, q, flush, click, typeInto, createHost } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { loadCompany } from '../src/lib/draft.js';

let App;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const seed = () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', phone: '', email: '' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  seed();
});
afterEach(() => h?.unmount());

describe('Ajustes: three cards', () => {
  it('shows Perfil / Idioma y País / Drive; email and phone persist and feed the company profile used by the PDFs', async () => {
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));

    expect(q('settings-profile')).not.toBeNull();
    expect(q('settings-locale').textContent).toContain('Idioma y País');
    expect(q('settings-cloud')).not.toBeNull();
    expect(q('settings-lang').querySelector('[data-testid="lang-select"]')).not.toBeNull();
    expect(q('settings-region')).not.toBeNull();
    expect(q('settings-logo').getAttribute('aria-label')).toBeTruthy();
    expect(q('settings-logo').textContent).toContain('Cambiar');
    expect(q('settings-logo').className).toContain('bg-transparent');
    expect(q('settings-logo').className).not.toMatch(/\bborder\b/);
    expect(q('settings-logo').className).not.toContain('bg-white');
    expect(q('settings-edit-profile')).toBeNull();
    expect(q('settings-company-phone').getAttribute('type')).toBe('tel');
    expect(q('settings-company-tax')).not.toBeNull();
    expect(q('settings-company-city')).not.toBeNull();
    expect(q('settings-signature').textContent).toContain('Configurar Firma Digital');

    await typeInto(q('settings-company-email'), 'obra@aurora.cl');
    await typeInto(q('settings-company-phone'), '+56 9 1234 5678');
    await typeInto(q('settings-company-tax'), '76.123.456-7');
    await typeInto(q('settings-company-city'), 'Santiago');
    await flush(400); // debounced auto-save

    expect(q('settings-company-email').value).toBe('obra@aurora.cl');
    expect(q('settings-company-phone').value).toBe('+56 9 1234 5678');
    expect(loadCompany().email).toBe('obra@aurora.cl');
    expect(loadCompany().phone).toBe('+56 9 1234 5678');
    expect(loadCompany().taxId).toBe('76.123.456-7');
    expect(loadCompany().city).toBe('Santiago');
    expect(loadCompany().name).toBe('Aurora');
    expect(q('settings-saved').className).toMatch(/opacity-100/);
    expect(q('settings-saved').textContent).toContain('Guardado');

    await click(q('settings-signature'));
    expect(q('contractor-sign-sheet')).not.toBeNull();
    expect(q('settings-profile')).toBeNull(); // only the signature canvas, not the old profile modal
  });

  it('a trailing space in "Profesional a cargo" survives typing and the autosave round-trip (no caret jump)', async () => {
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    const pro = q('settings-pro-name');
    await typeInto(pro, 'Ana ');
    expect(pro.value).toBe('Ana '); // space still there right after onChange
    await flush(400); // autosave would previously trim via company sync and eat the space
    expect(q('settings-pro-name').value).toBe('Ana '); // local input untouched
    expect(loadCompany().proName).toBe('Ana'); // storage is trimmed
    await typeInto(q('settings-pro-name'), 'Ana Ruiz');
    await flush(400);
    expect(loadCompany().proName).toBe('Ana Ruiz');
    expect(q('settings-saved').textContent).toContain('Guardado');
  });
});
