// @vitest-environment happy-dom
// The opening screen: ALWAYS shown (installed PWA or browser), the continuation of the system splash: static logo in a 128 px box at the exact centre,
// only the texts fade in, ~1.15 s in total, then a fade-out into the app (even with a session).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import SplashScreen, { SPLASH_TIMING, SPLASH_LOGO_SIZE, SPLASH_LOGO_BOX, TEXT_FADE_MS } from '../src/components/SplashScreen.jsx';
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
    expect(q('splash').textContent).toContain('Un producto Japadigital');
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
    expect(q('splash').textContent).toContain('Un producto Japadigital');
    expect(q('splash-name')).not.toBeNull();
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

  it('the logo lives in an exact 128 px box, at the absolute centre of a 100dvh x screen-width viewport, and is STATIC', async () => {
    seed();
    await mount(React.createElement(App));
    const root = q('splash');
    for (const c of ['h-[100dvh]', 'w-screen', 'flex', 'items-center', 'justify-center', 'relative', 'overflow-hidden']) expect(root.className.split(/\s+/)).toContain(c);
    const box = q('splash-logo');
    expect(SPLASH_LOGO_BOX).toBe(128);
    expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-32', 'h-32', 'flex', 'items-center', 'justify-center']));
    expect(box.style.width).toBe('128px');
    expect(box.style.height).toBe('128px');
    expect(box.parentElement).toBe(root); // in-flow child of the centring flex container
    expect(box.className).not.toMatch(/\b(p|m|px|py|pt|pb|mt|mb|ml|mr|absolute)-?/);
    // the logo fits the box (contain): never taller or wider than 128, nothing offsets it
    const logo = box.querySelector('[data-testid="logo"]');
    expect(SPLASH_LOGO_SIZE).toBe(128);
    expect(parseFloat(logo.style.height)).toBeLessThanOrEqual(128);
    expect(parseFloat(logo.style.width)).toBeLessThanOrEqual(128);
    expect(logo.className).not.toMatch(/\b(p|m|px|py|pt|pb|mt|mb|ml|mr)-/);
    expect(logo.style.margin || '').toBe('');
    expect(logo.style.padding || '').toBe('');
    expect(box.querySelector('[data-testid="logo-helmet"]').style.objectFit).toBe('contain');
    for (const el of [box, ...box.querySelectorAll('*')]) {
      expect(el.style.animation || '').toBe('');
      expect(el.className?.baseVal ?? el.className).not.toMatch(/animate|transition/);
    }
  });

  it('ONLY the texts fade in (opacity 0 -> 1, 500 ms): CUBRAX and the credit', async () => {
    seed();
    await mount(React.createElement(App));
    for (const id of ['splash-name', 'splash-credit']) {
      expect(q(id).style.animation).toContain('splash-text-in');
      expect(q(id).style.animation).toContain('500ms');
    }
    expect(q('splash-logo').style.animation).toBe('');
    // the lettering hangs under the logo without taking part in its position
    for (const id of ['splash-name']) expect(q(id).className.split(/\s+/)).toContain('absolute');
    expect(q('splash-logo').className).not.toContain('absolute'); // the logo is the only in-flow child: the texts cannot push it
  });

  it('without timing (tests) nothing animates at all', async () => {
    seed();
    const { default: S } = await import('../src/components/SplashScreen.jsx');
    await mount(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(S, { onStart: () => {}, auto: false, timing: { hold: 0, fade: 0 } })));
    expect(q('splash-credit').style.animation).toBe('');
  });
});
