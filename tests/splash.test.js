// @vitest-environment happy-dom
// The opening screen: ALWAYS shown, 1.5 s, then a fade-out into the app (even with a session).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import SplashScreen, { SPLASH_TIMING } from '../src/components/SplashScreen.jsx';
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
  it('is held 1.5 s, then fades out and the Dashboard appears - even when the user already has a session', async () => {
    expect(SPLASH_TIMING.hold).toBe(1500);
    seed();
    await mount(React.createElement(App));
    expect(q('splash')).not.toBeNull();
    expect(q('splash').textContent).toContain('Un producto Japadigital');
    expect(q('splash-start')).toBeNull(); // nothing to press: it leaves by itself
    expect(q('dash-empty')).toBeNull();
    await advance(1400);
    expect(q('splash')).not.toBeNull();
    expect(q('splash').getAttribute('data-leaving')).toBeNull();
    await advance(150); // 1.55 s: the fade-out has started
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
    await advance(1500 + SPLASH_TIMING.fade + 50);
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
    await advance(1500);
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
