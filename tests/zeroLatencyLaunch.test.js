// @vitest-environment happy-dom
// Zero-latency launch: an installed app (standalone) shows the system splash only; React goes straight to the main view.
// Browsers and first visits keep the welcome screen, with a brand blink instead of a 2 s wait.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import App from '../src/App.jsx';
import { SPLASH_TIMING } from '../src/components/SplashScreen.jsx';
import { isStandalone } from '../src/pwa/installPrompt.js';
import { projectStore } from '../src/lib/projectStore.js';
import { q, flush, createHost } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const seedReturning = () => {
  localStorage.clear();
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'IT', lang: 'it' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
};
let h;
const originalMatchMedia = window.matchMedia;
beforeEach(async () => {
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
});
afterEach(() => {
  h?.unmount();
  localStorage.clear();
  window.matchMedia = originalMatchMedia;
  delete navigator.standalone;
});

describe('no artificial wait', () => {
  it('the welcome screen of a browser is a blink: well under a second in total (it was 1950 ms)', () => {
    expect(SPLASH_TIMING.hold + SPLASH_TIMING.fade).toBeLessThanOrEqual(700);
  });
});

describe('installed app: straight to the main view', () => {
  it('a returning user never sees the React splash: the very first render is the main view (black shell / projects)', async () => {
    seedReturning();
    h = createHost(App, { splash: SPLASH_TIMING, installed: true });
    await h.mount();
    expect(q('splash')).toBeNull(); // not even for a frame
    expect(q('app-shell') || q('fab-new')).not.toBeNull();
    await flush(60);
    expect(q('splash')).toBeNull();
    expect(q('fab-new')).not.toBeNull(); // the projects view, with no timer involved
  });

  it('it detects the installed app by itself (display-mode: standalone) when no prop is given', async () => {
    seedReturning();
    window.matchMedia = (query) => ({ matches: query.includes('standalone'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    expect(isStandalone()).toBe(true);
    h = createHost(App, { splash: SPLASH_TIMING });
    await h.mount();
    expect(q('splash')).toBeNull();
  });

  it('iOS home-screen apps (navigator.standalone) count too', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });

  it('cold start of a first run keeps the welcome screen with its "Iniciar" button, installed or not', async () => {
    localStorage.clear();
    h = createHost(App, { splash: SPLASH_TIMING, installed: true });
    await h.mount();
    expect(q('splash')).not.toBeNull();
    expect(q('splash-start')).not.toBeNull();
  });

  it('an installed app of a signed-out profile-less visitor (no user, no company) also gets the welcome screen', async () => {
    localStorage.clear();
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'IT', lang: 'it' }));
    h = createHost(App, { splash: SPLASH_TIMING, installed: true });
    await h.mount();
    expect(q('splash')).not.toBeNull();
  });
});

describe('browser tab of a returning user', () => {
  it('still gets the short brand blink, then the main view by itself', async () => {
    seedReturning();
    h = createHost(App, { splash: SPLASH_TIMING, installed: false });
    await h.mount();
    expect(q('splash')).not.toBeNull();
    expect(q('splash-start')).toBeNull(); // no button: it moves on alone
    await flush(SPLASH_TIMING.hold + SPLASH_TIMING.fade + 150);
    expect(q('splash')).toBeNull();
    expect(q('fab-new')).not.toBeNull();
  });
});
