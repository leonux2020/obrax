// @vitest-environment happy-dom
// Ajustes is a TOP-LEVEL full-screen view wired to the bottom-nav tab (like native tabs), never a floating sheet.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CLIENT, q, flush, click, createHost } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';

let App;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const seed = (lang = 'es') => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang, langLocked: true }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', phone: '', email: '' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  window.history.replaceState(null, '');
});
afterEach(() => h?.unmount());

const mount = async (lang) => {
  seed(lang);
  h = createHost(App);
  await h.mount();
};

describe('Ajustes as a full-screen tab', () => {
  it('tapping the tab swaps the whole main context: projects hidden, only Ajustes in the viewport, tab marked active', async () => {
    await mount();
    expect(q('settings-view')).toBeNull();
    await click(h.tab('Ajustes'));
    expect(q('settings-view')).not.toBeNull();
    expect(q('project-card')).toBeNull();
    expect(q('fab-new')).toBeNull(); // the dashboard is gone
    expect(q('nav-settings').getAttribute('aria-current')).toBe('page');
    expect(q('nav-projects').getAttribute('aria-current')).toBeNull();
    expect(h.host.querySelector('nav')).not.toBeNull(); // the bottom nav stays: it is the way out
  });

  it('own OLED background and a clean title header (Impostazioni in Italian)', async () => {
    await mount('it');
    await click(q('nav-settings'));
    expect(q('settings-view').className).toContain('bg-black');
    expect(q('settings-view').className).toContain('min-h-screen');
    const title = q('settings-title');
    expect(title.tagName).toBe('H1');
    expect(title.textContent).toBe('Impostazioni');
    expect(q('settings-view').querySelector('main').className).toMatch(/pb-44/); // never hidden behind the bottom nav
  });

  it('no floating-window behaviour: no dialog, no close (X), no backdrop, no drag handle / swipe', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.querySelector('[data-sheet-close]')).toBeNull();
    expect(q('sheet-backdrop')).toBeNull();
    expect(q('settings-view').querySelector('[data-sheet-close], [data-testid="sheet-handle"]')).toBeNull();
    expect(q('settings-view').getAttribute('ontouchmove')).toBeNull();
  });

  it('leaving is just tapping another tab; coming back shows the same screen, and every tab works', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    await click(h.tab('Contabilidad'));
    expect(q('settings-view')).toBeNull();
    expect(q('accounting')).not.toBeNull();
    await click(h.tab('Ajustes'));
    expect(q('settings-view')).not.toBeNull();
    expect(q('accounting')).toBeNull();
    await click(h.tab('Proyectos'));
    expect(q('settings-view')).toBeNull();
    expect(q('fab-new')).not.toBeNull();
  });

  it('opening Ajustes does not lose what is there: language change applies in place and the screen stays', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    const select = q('settings-lang').querySelector('select');
    await (async () => {
      const { act } = await import('react');
      await act(async () => {
        select.value = 'it';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    })();
    await flush(60);
    expect(q('settings-view')).not.toBeNull();
    expect(q('settings-title').textContent).toBe('Impostazioni');
  });

  it('source: the sheet component is gone, the view does not use BottomSheet and takes no onClose', () => {
    expect(existsSync('src/components/SettingsSheet.jsx')).toBe(false);
    const view = readFileSync('src/components/SettingsView.jsx', 'utf8');
    expect(view).not.toMatch(/import BottomSheet/);
    expect(view).not.toMatch(/<BottomSheet/);
    expect(view).not.toMatch(/^\s*onClose,$/m);
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).not.toMatch(/type: 'settings'/);
    expect(app).toMatch(/onSettings=\{\(\) => setTab\('settings'\)\}/);
  });
});
