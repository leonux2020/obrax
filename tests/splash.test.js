// @vitest-environment happy-dom
// Zero-latency boot: an installed app (and anybody with a profile) starts in the main view with 0 artificial ms: no splash, no timer, no fade.
// The React welcome screen survives only as a minimal first visit in a browser tab (one "Iniciar" button).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import SplashScreen from '../src/components/SplashScreen.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { isStandalone } from '../src/pwa/installPrompt.js';
import { projectStore } from '../src/lib/projectStore.js';

let host;
let root;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const advance = (ms) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const mount = async (node) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
};
const seed = ({ user = true } = {}) => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  if (user) localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
};

beforeEach(async () => {
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  localStorage.clear();
  delete window.matchMedia;
  delete navigator.standalone;
});

const asInstalledPwa = () => {
  window.matchMedia = (query) => ({ matches: query.includes('standalone'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
};

describe('installed app: straight to the main view, 0 artificial ms', () => {
  it('a returning user never sees the React splash: the very first render is the main view, with no timer involved', async () => {
    seed();
    await mount(React.createElement(App, { installed: true }));
    expect(q('splash')).toBeNull(); // not even for a frame
    expect(q('app-shell') || q('fab-new') || q('dash-empty')).not.toBeNull();
    await advance(0);
    expect(q('splash')).toBeNull();
    expect(q('dash-empty') || q('fab-new')).not.toBeNull();
    await advance(5000);
    expect(q('splash')).toBeNull();
  });

  it('it detects the installed app by itself (display-mode: standalone) when no prop is given', async () => {
    asInstalledPwa();
    expect(isStandalone()).toBe(true);
    seed();
    await mount(React.createElement(App));
    expect(q('splash')).toBeNull();
    await advance(0);
    expect(q('dash-empty') || q('fab-new')).not.toBeNull();
  });

  it('iOS home-screen apps (navigator.standalone) count too', async () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
    seed();
    await mount(React.createElement(App));
    expect(q('splash')).toBeNull();
  });

  it('a signed-out returning user lands on the access screen with no splash in between', async () => {
    seed({ user: false });
    await mount(React.createElement(App, { installed: true }));
    expect(q('splash')).toBeNull();
    await advance(0);
    expect(q('dash-empty')).toBeNull();
    expect(host.textContent).toMatch(/Google|perfil|Entrar|Acceder/i);
  });

  it('an installed app of a brand-new profile goes straight to the setup: no welcome screen, no "Iniciar", the country comes from the device', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'IT', lang: 'it' }));
    await mount(React.createElement(App, { installed: true }));
    expect(q('splash')).toBeNull();
    expect(q('splash-start')).toBeNull();
    expect(q('setup')).not.toBeNull();
  });
});

describe('browser tab', () => {
  it('a returning user does not get a splash either: main view at once', async () => {
    seed();
    await mount(React.createElement(App, { installed: false }));
    expect(q('splash')).toBeNull();
    await advance(0);
    expect(q('dash-empty') || q('fab-new')).not.toBeNull();
  });

  it('the FIRST visit keeps a minimal welcome: black, one "Iniciar" button, nothing else, and it never leaves on its own', async () => {
    await mount(React.createElement(App, { installed: false }));
    expect(q('splash-start').textContent).toBe('Iniciar');
    expect(q('splash').className).toContain('bg-black');
    expect(q('splash-credit')).toBeNull(); // the credit is gone
    // the logo (hard hat isotype) is centred right above the buttons, 128 px high, with generous air below
    const logo = q('splash-logo');
    expect(logo.className).toMatch(/mx-auto/);
    expect(logo.className).toMatch(/mb-10/);
    expect(logo.querySelector('[data-testid="logo"]').style.height).toBe('128px');
    expect(logo.querySelector('img').getAttribute('src')).toMatch(/helmet\.png$/);
    expect(logo.compareDocumentPosition(q('splash-start')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // above the button
    expect(q('splash').querySelector('[data-testid="wordmark"]')).toBeNull();
    expect(q('splash-name').className).toContain('sr-only');
    expect(vi.getTimerCount()).toBe(0);
    await advance(10_000);
    expect(q('splash')).not.toBeNull();
    expect(q('setup')).toBeNull();
    for (const el of [q('splash'), ...q('splash').querySelectorAll('*')]) {
      expect(el.style.animation || '').toBe('');
      expect(el.style.transitionDuration || '').toBe('');
    }
  });

  it('"Iniciar" leads to the setup', async () => {
    await mount(React.createElement(App, { installed: false }));
    await act(async () => {
      q('splash-start').click();
    });
    expect(q('splash')).toBeNull();
  });
});

describe('the component', () => {
  const withI18n = (props) => React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(SplashScreen, props));

  it('`auto` (back from Google consent) continues in the same frame, calling onStart once and arming no timer', async () => {
    const onStart = vi.fn();
    await mount(withI18n({ onStart, auto: true }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('the source holds no timer, no credit and no animation; the stylesheet no longer has the fade keyframes', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/SplashScreen.jsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/setTimeout|setInterval|animation|transition|splash\.credit|<Wordmark|<img/);
    expect(fs.readFileSync('src/index.css', 'utf8')).not.toContain('splash-text-in');
    expect(fs.readFileSync('src/App.jsx', 'utf8')).toContain('isStandalone');
  });
});
