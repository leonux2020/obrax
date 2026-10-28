// @vitest-environment happy-dom
// Without VITE_GOOGLE_CLIENT_ID in the build (Vercel without the variable) the Ajustes card says exactly what is missing.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { q, click, createHost } from './helpers/appHarness.js';

let App;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', ''); // as when Vercel builds without the variable
  App = (await import('../src/App.jsx')).default;
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
});
afterEach(() => h?.unmount());

describe('Drive without VITE_GOOGLE_CLIENT_ID', () => {
  it('shows the administrator diagnostic, no connect button, no "Respaldar ahora"; nothing crashes', async () => {
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    const card = q('settings-backup');
    expect(card.dataset.state).toBe('unconfigured');
    expect(q('backup-config-diagnostic').textContent).toBe('VITE_GOOGLE_CLIENT_ID ausente en Vercel. Configura las variables de entorno para activar Drive.');
    expect(q('backup-config-diagnostic').dataset.config).toBe('missing');
    expect(q('backup-connect')).toBeNull();
    expect(q('backup-now')).toBeNull();
    expect(card.textContent).not.toContain('Conectado a Google Drive');
  });
});
