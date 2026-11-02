// @vitest-environment happy-dom
// "Instalar App" lifecycle: beforeinstallprompt captured globally (early script + module), the button opens the NATIVE dialog, the manual
// hint only appears when there is no deferredPrompt, and appinstalled hides the button for good.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import InstallButton from '../src/components/InstallButton.jsx';
import { usePWA } from '../src/pwa/usePWA.js';
import { __resetInstallForTests, getInstallState, promptInstall, startInstallCapture } from '../src/pwa/installPrompt.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bip = (outcome = 'accepted') => {
  const ev = new Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = vi.fn(async () => {});
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
};

function Probe() {
  const pwa = usePWA();
  return React.createElement(InstallButton, { pwa });
}

describe('lifecycle in the module', () => {
  beforeEach(() => __resetInstallForTests());

  it('beforeinstallprompt: preventDefault + stored; tapping calls prompt(), waits for userChoice and only then clears it', async () => {
    startInstallCapture();
    let release;
    const ev = bip();
    ev.userChoice = new Promise((r) => (release = r));
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(getInstallState().canPrompt).toBe(true);
    const p = promptInstall();
    expect(ev.prompt).toHaveBeenCalledTimes(1); // inside the tap (same tick): browsers require the user gesture
    expect(getInstallState().canPrompt).toBe(true); // still stored while the user decides
    release({ outcome: 'accepted' });
    expect(await p).toBe('accepted');
    expect(getInstallState().canPrompt).toBe(false); // cleared (deferredPrompt = null)
    expect(await promptInstall()).toBe('manual'); // ONLY now the manual instructions
  });

  it('a second tap while the native dialog is open never calls prompt() twice', async () => {
    startInstallCapture();
    let release;
    const ev = bip();
    ev.userChoice = new Promise((r) => (release = r));
    window.dispatchEvent(ev);
    const first = promptInstall();
    expect(await promptInstall()).toBe('dismissed');
    release({ outcome: 'dismissed' });
    expect(await first).toBe('dismissed');
    expect(ev.prompt).toHaveBeenCalledTimes(1);
  });

  it('the event seen by the early head script (before the bundle) is adopted', async () => {
    const ev = bip();
    window.__cubraxInstall = { event: ev, installed: false };
    startInstallCapture();
    expect(getInstallState().canPrompt).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(ev.prompt).toHaveBeenCalledTimes(1);
  });

  it('appinstalled: not installable any more, installed for good (also in the next visit); a new beforeinstallprompt means it was uninstalled', async () => {
    startInstallCapture();
    window.dispatchEvent(bip());
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallState()).toEqual({ canPrompt: false, installed: true });
    expect(localStorage.getItem('cubrax.installed')).toBe('1');

    // next visit from the browser tab: a fresh module, the flag survives
    vi.resetModules();
    const fresh = await import('../src/pwa/installPrompt.js');
    fresh.startInstallCapture();
    expect(fresh.getInstallState().installed).toBe(true);
    // the browser offers the install again = it is not installed any more
    const again = bip();
    window.dispatchEvent(again);
    expect(fresh.getInstallState()).toEqual({ canPrompt: true, installed: false });
    expect(localStorage.getItem('cubrax.installed')).toBeNull();
  });

  it('appinstalled seen by the early script is honoured too', () => {
    window.__cubraxInstall = { event: null, installed: true };
    startInstallCapture();
    expect(getInstallState().installed).toBe(true);
  });
});

describe('the head script (public/install-capture.js)', () => {
  it('keeps the event (preventDefault) and the appinstalled flag in window.__cubraxInstall', () => {
    delete window.__cubraxInstall;
    new Function(fs.readFileSync('public/install-capture.js', 'utf8'))(); // eslint-disable-line no-new-func
    const ev = bip();
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(window.__cubraxInstall.event).toBe(ev);
    window.dispatchEvent(new Event('appinstalled'));
    expect(window.__cubraxInstall).toMatchObject({ event: null, installed: true });
  });
  it('is the first script of index.html, an external file (the CSP only allows \'self\') and not a module', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    expect(html).toMatch(/<script src="\/install-capture\.js"><\/script>/);
    expect(html.indexOf('install-capture.js')).toBeLessThan(html.indexOf('type="module"'));
    expect(html).not.toMatch(/<script>[^<]/); // no inline script (CSP)
  });
});

describe('the button', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  beforeEach(() => {
    __resetInstallForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const mount = () => act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Probe))));
  const tap = async () => {
    await act(async () => {
      q('install-app').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
  };

  it('with the browser event: one tap opens the native dialog and NO manual text appears', async () => {
    await mount();
    const ev = bip();
    await act(async () => window.dispatchEvent(ev));
    expect(q('install-app').dataset.native).toBe('true');
    await tap();
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(q('install-hint')).toBeNull();
  });

  it('after the user dismisses the native dialog there is no scary manual text either', async () => {
    await mount();
    await act(async () => window.dispatchEvent(bip('dismissed')));
    await tap();
    expect(q('install-hint')).toBeNull();
    expect(q('install-app')).not.toBeNull(); // still installable by hand later
  });

  it('with no deferredPrompt (Safari / iOS) the tap shows the manual instructions', async () => {
    await mount();
    expect(q('install-app').dataset.native).toBe('false');
    await tap();
    expect(q('install-hint').textContent).toMatch(/instalar app|pantalla de inicio/i);
  });

  it('appinstalled removes the button from the screen at once', async () => {
    await mount();
    await act(async () => window.dispatchEvent(bip()));
    expect(q('install-app')).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event('appinstalled')));
    expect(q('install-app')).toBeNull();
  });
});
