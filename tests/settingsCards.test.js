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

    await typeInto(q('settings-company-email'), 'obra@aurora.cl');
    await typeInto(q('settings-company-phone'), '+56912345678');
    await flush(400); // debounced auto-save

    expect(q('settings-company-email').value).toBe('obra@aurora.cl');
    expect(loadCompany().email).toBe('obra@aurora.cl');
    expect(loadCompany().phone).toBe('+56912345678');
    expect(loadCompany().name).toBe('Aurora');
  });
});
