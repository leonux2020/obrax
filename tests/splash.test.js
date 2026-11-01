// @vitest-environment happy-dom
// The opening screen: ALWAYS shown (installed PWA or browser), the continuation of the system splash: the OS draws the logo, React only the credit,
// only the texts fade in, ~1.15 s in total, then a fade-out into the app (even with a session).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import SplashScreen, { SPLASH_TIMING, TEXT_FADE_MS } from '../src/components/SplashScreen.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';

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

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  localStorage.clear();
});

describe('opening screen', () => {
  it('is held for the brief SPLASH_TIMING hold, then fades out and the Dashboard appears - even when the user already has a session', async () => {
    const { hold, fade } = SPLASH_TIMING;
    seed();
    await mount(React.createElement(App));
    expect(q('splash')).not.toBeNull();
    expect(q('splash-credit').textContent).toBe('Un producto Japadigital');
    expect(q('splash-start')).toBeNull(); // nothing to press: it leaves by itself
    expect(q('dash-empty')).toBeNull();
    await advance(hold - 50);
    expect(q('splash')).not.toBeNull();
    expect(q('splash').getAttribute('data-leaving')).toBeNull();
    await advance(100); // the hold is over: the fade-out has started
    expect(q('splash')).not.toBeNull();
    expect(q('splash').getAttribute('data-leaving')).toBe('true');
    expect(q('splash').className).toContain('opacity-0');
    expect(q('splash').className).toContain('transition-opacity');
    await advance(SPLASH_TIMING.fade + 50);
    expect(q('splash')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();
  });

  it('a signed-out returning user also sees it first, then lands on the access screen', async () => {
    seed({ user: false });
    await mount(React.createElement(App));
    expect(q('splash')).not.toBeNull();
    await advance(SPLASH_TIMING.hold + SPLASH_TIMING.fade + 50);
    expect(q('splash')).toBeNull();
    expect(q('dash-empty')).toBeNull();
    expect(host.textContent).toMatch(/Google|perfil|Entrar|Acceder/i);
  });

  it('first run keeps the single "Iniciar" button and does not leave on its own', async () => {
    await mount(React.createElement(App));
    expect(q('splash-start').textContent).toBe('Iniciar');
    await advance(10_000);
    expect(q('splash')).not.toBeNull();
    expect(q('setup')).toBeNull();
  });

  it('the component only calls onStart once, after hold + fade, and cleans its timers when unmounted early', async () => {
    const onStart = vi.fn();
    await mount(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(SplashScreen, { onStart, auto: true })));
    await advance(SPLASH_TIMING.hold);
    expect(onStart).not.toHaveBeenCalled();
    await advance(SPLASH_TIMING.fade);
    expect(onStart).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    host.remove();
    const early = vi.fn();
    await mount(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(SplashScreen, { onStart: early, auto: true })));
    act(() => root.unmount());
    await advance(5000);
    expect(early).not.toHaveBeenCalled();
    root = createRoot(host); // so afterEach can unmount
  });
});

describe('seamless handoff with the system splash', () => {
  const root = () => q('splash');
  const asInstalledPwa = () => {
    window.matchMedia = (query) => ({ matches: query.includes('standalone'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  };
  afterEach(() => {
    delete window.matchMedia;
  });

  it('an INSTALLED app shows the React splash too (the brand texts are back), then goes on by itself', async () => {
    asInstalledPwa();
    seed();
    await mount(React.createElement(App));
    expect(q('splash')).not.toBeNull();
    expect(q('splash-credit').textContent).toBe('Un producto Japadigital');
        await advance(SPLASH_TIMING.hold + SPLASH_TIMING.fade + 50);
    expect(q('splash')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();
  });

  it('timing: 1.0 - 1.2 s in total, and the text fade-in (500 ms) fits inside the hold', () => {
    const total = SPLASH_TIMING.hold + SPLASH_TIMING.fade;
    expect(total).toBeGreaterThanOrEqual(1000);
    expect(total).toBeLessThanOrEqual(1200);
    expect(TEXT_FADE_MS).toBe(500);
    expect(TEXT_FADE_MS).toBeLessThan(SPLASH_TIMING.hold);
  });

  it('Single-Render Splash: the centre is EMPTY black (no hat, no lettering, no image), the OS logo stays untouched', async () => {
    seed();
    await mount(React.createElement(App));
    const root = q('splash');
    for (const c of ['h-[100dvh]', 'w-screen', 'relative', 'overflow-hidden', 'bg-black']) expect(root.className.split(/\s+/)).toContain(c);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[data-testid="logo"]')).toBeNull();
    expect(root.querySelector('[data-testid="wordmark"]')).toBeNull();
    expect(q('splash-logo')).toBeNull();
    // the name survives only as a visually hidden heading
    expect(q('splash-name').className).toContain('sr-only');
    expect(q('splash-name').textContent).toBe('CUBRAX');
  });

  it('ONLY the credit "Un producto Japadigital" is visible: absolute at the bottom and fading in (opacity 0 -> 1, 500 ms)', async () => {
    seed();
    await mount(React.createElement(App));
    const credit = q('splash-credit');
    expect(credit.textContent).toBe('Un producto Japadigital');
    expect(credit.style.animation).toContain('splash-text-in');
    expect(credit.style.animation).toContain('500ms');
    const bottom = credit.closest('.absolute');
    expect(bottom).not.toBeNull();
    expect(bottom.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'bottom-0', 'inset-x-0']));
    // nothing else in the splash animates
    for (const el of root().querySelectorAll('*')) if (el !== credit) expect(el.style.animation || '').toBe('');
  });

  it('without timing (tests) nothing animates at all', async () => {
    seed();
    const { default: S } = await import('../src/components/SplashScreen.jsx');
    await mount(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(S, { onStart: () => {}, auto: false, timing: { hold: 0, fade: 0 } })));
    expect(q('splash-credit').style.animation).toBe('');
  });
});
