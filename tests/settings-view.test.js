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

const idx = (el) => [...document.querySelectorAll('*')].indexOf(el);

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

describe('Ajustes "Zero Stress": main block, quiet logout, invisible autosave', () => {
  it('Profilo, Firma Digitale and Google Drive form ONE main block at the top, each row with a grey line icon', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    const main = q('settings-main');
    expect(main).not.toBeNull();
    for (const id of ['settings-profile', 'settings-signature', 'settings-cloud']) expect(main.contains(q(id)), id).toBe(true);
    for (const id of ['settings-profile', 'settings-signature', 'settings-cloud']) {
      const svg = q(id).querySelector('svg[data-outline-icon="true"]');
      expect(svg, id).not.toBeNull();
      expect(svg.getAttribute('class')).toContain('text-neutral-400');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
    }
    expect(q('settings-drive').textContent).toBe('Sincronizar con Google Drive');
    // order: main block, then language & country, then everything else
    expect(idx(q('settings-main'))).toBeLessThan(idx(q('settings-locale')));
    expect(idx(q('settings-profile'))).toBeLessThan(idx(q('settings-signature')));
    expect(idx(q('settings-signature'))).toBeLessThan(idx(q('settings-cloud')));
    // the Drive row stays a real switch
    expect(q('settings-drive').getAttribute('role')).toBe('switch');
  });

  it('the Drive row says "Sincronizza con Google Drive" in Italian and exists in the six languages', async () => {
    const { DICT } = await import('../src/lib/dict.js');
    expect(DICT.it['settings.driveSync']).toBe('Sincronizza con Google Drive');
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l]['settings.driveSync'], l).toBeTruthy();
    await mount('it');
    await click(q('nav-settings'));
    expect(q('settings-drive').textContent).toBe('Sincronizza con Google Drive');
  });

  it('there is no autosave switch and no "Guardado" badge anywhere: saving is implicit (it still persists)', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(1); // only the Drive one
    expect(q('settings-saved')).toBeNull();
    expect(q('settings-view').textContent).not.toMatch(/guardado autom|salvataggio autom|auto-?save/i);
    const { act } = await import('react');
    const input = q('settings-pro-name');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Ana Soto');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush(400);
    expect(JSON.parse(localStorage.getItem('cp.company.v1')).proName).toBe('Ana Soto');
  });

  it('the logout is buried at the very bottom, grey and outlined: no solid red, needs a real second tap', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    const btn = q('logout-button');
    expect(btn.className).toContain('text-neutral-500');
    expect(btn.className).toContain('border-white/10');
    expect(btn.className).toContain('bg-transparent');
    expect(btn.className).not.toMatch(/bg-red|bg-brand|font-bold|font-extrabold/);
    // it is the LAST thing on the screen, below every other control (install, account, language)
    const all = [...q('settings-view').querySelectorAll('button, [role="switch"], select, input')];
    expect(all[all.length - 1]).toBe(btn);
    expect(q('settings-logout-zone').contains(btn)).toBe(true);
    expect(idx(q('settings-locale'))).toBeLessThan(idx(btn));
    expect(idx(q('settings-cloud'))).toBeLessThan(idx(btn));
    // the confirmation step is an outlined red, never a solid fill
    await click(btn);
    expect(q('logout-confirm').className).not.toMatch(/(^|\s)bg-red-/);
    expect(q('logout-confirm').className).toContain('border-red-500/40');
  });

  it('"Instalar App" is a secondary quiet button after the main block, still on the splash with its original look', async () => {
    const { default: InstallButton } = await import('../src/components/InstallButton.jsx');
    const React = (await import('react')).default;
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/lib/i18n.jsx');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const r = createRoot(el);
    const pwa = { installed: false, canInstall: true, install: async () => 'accepted' };
    await act(async () => {
      r.render(
        React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, [
          React.createElement(InstallButton, { key: 'a', pwa, quiet: true }),
          React.createElement(InstallButton, { key: 'b', pwa }),
        ]),
      );
    });
    const [quiet, loud] = [...el.querySelectorAll('[data-testid="install-app"]')];
    expect(quiet.className).toContain('border-white/10');
    expect(quiet.className).toContain('text-neutral-400');
    expect(quiet.className).not.toContain('border-brand');
    expect(loud.className).toContain('border-brand');
    act(() => r.unmount());
    el.remove();
  });
});
