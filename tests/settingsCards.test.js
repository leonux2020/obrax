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
    expect(q('settings-lang').tagName).toBe('BUTTON'); // a flat row, not a select box
    expect(q('settings-lang-value').textContent).toBe('Español');
    expect(q('settings-region')).not.toBeNull();
    expect(q('settings-logo')).toBeNull(); // read-only card until the pencil
    expect(q('settings-company-email')).toBeNull();
    await click(q('settings-profile-edit'));
    expect(q('settings-logo').getAttribute('aria-label')).toBeTruthy();
    expect(q('settings-logo').textContent).toContain('Cambiar');
    expect(q('settings-logo').className).toContain('bg-transparent');
    expect(q('settings-logo').className).not.toMatch(/\bborder\b/);
    expect(q('settings-logo').className).not.toContain('bg-white');
    expect(q('settings-edit-profile')).toBeNull();
    expect(q('settings-company-phone').getAttribute('type')).toBe('tel');
    expect(q('settings-company-tax')).not.toBeNull();
    expect(q('settings-company-city')).not.toBeNull();
    expect(q('settings-signature')).toBeNull(); // the signature is not in Google Sync: it is the canvas of the professional
    expect(q('pro-signature')).not.toBeNull();
    expect(q('settings-company-address')).not.toBeNull();
    for (const id of ['settings-pro-name', 'settings-pro-lastname', 'settings-pro-title', 'settings-pro-license']) expect(q(id), id).not.toBeNull();

    await typeInto(q('settings-company-email'), 'obra@aurora.cl');
    await typeInto(q('settings-company-phone'), '+56 9 1234 5678');
    await typeInto(q('settings-company-tax'), '76.123.456-7');
    await typeInto(q('settings-company-city'), 'Santiago');
    await typeInto(q('settings-company-address'), 'Av. Providencia 123');
    await typeInto(q('settings-pro-lastname'), 'Soto');
    await typeInto(q('settings-pro-title'), 'Ingeniero civil');
    await typeInto(q('settings-pro-license'), 'CIP 4521');
    await flush(400); // nothing is written until Save
    expect(loadCompany().email).toBe('');
    await click(q('settings-profile-save'));

    expect(q('settings-profile-email').textContent).toBe('obra@aurora.cl');
    expect(q('settings-profile-phone').textContent).toBe('+56 9 1234 5678');
    expect(loadCompany().email).toBe('obra@aurora.cl');
    expect(loadCompany().phone).toBe('+56 9 1234 5678');
    expect(loadCompany().taxId).toBe('76.123.456-7');
    expect(loadCompany().city).toBe('Santiago');
    expect(loadCompany().name).toBe('Aurora');
    expect(loadCompany().address).toBe('Av. Providencia 123');
    expect(loadCompany().proLastName).toBe('Soto');
    expect(loadCompany().proTitle).toBe('Ingeniero civil');
    expect(loadCompany().proLicense).toBe('CIP 4521');
    expect(q('settings-saved')).toBeNull(); // no "Guardado" badge, no switch
    expect(q('settings-profile-form')).toBeNull(); // Save returns to the refreshed read card
    expect(q('settings-profile-pro').textContent).toBe('Ana Ruiz Soto');
    expect(q('settings-profile-title').textContent).toBe('Ingeniero civil');
  });

  it('a trailing space survives typing; storage is trimmed on Save', async () => {
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    await click(q('settings-profile-edit'));
    const pro = q('settings-pro-name');
    await typeInto(pro, 'Ana ');
    expect(pro.value).toBe('Ana '); // the space is still there while typing
    await flush(400);
    expect(q('settings-pro-name').value).toBe('Ana ');
    expect(loadCompany().proName).toBe('Ana Ruiz'); // nothing written yet
    await click(q('settings-profile-save'));
    expect(loadCompany().proName).toBe('Ana'); // storage is trimmed
    expect(q('settings-profile-pro').textContent).toBe('Ana');
  });
});
