// Shared helpers for the app-level Drive tests: DOM helpers + a fake Google Identity Services (token client)
// wired to the fake Drive.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const CLIENT = 'test-client-123.apps.googleusercontent.com';
export const q = (id) => document.querySelector(`[data-testid="${id}"]`);
export const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
export const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const setNative = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

// Numeric fields never open the OS keyboard: they are read-only and a tap opens the app's NumberPad. For those fields `typeInto`
// does what a thumb does: open the pad, (reset if needed,) press the keys, confirm. Plain text fields keep the native path.
export const typeInto = async (input, value) => {
  if (input.dataset?.numpad !== 'true') return setNative(input, value);
  const text = String(value);
  await click(input);
  const pad = document.querySelector('[data-testid="field-numpad"]');
  const press = (id) => click(pad.querySelector(`[data-testid="pad-${id}"]`));
  if (text === '') {
    await click(pad.querySelector('[data-testid="pad-reset"]'));
    return;
  }
  for (const ch of text) await press(ch === '.' || ch === ',' ? 'dot' : ch);
  await click(pad.querySelector('[data-testid="pad-done"]'));
};

// The project workspace has NO back arrow: the device's back (Android gesture / button, browser arrow) leaves it. history.back() is the
// real thing: useHistoryBack pushed an entry when the project opened.
export const deviceBack = async () => {
  await act(async () => {
    window.history.back();
  });
  await flush(30);
};

// A project (new or opened) lives in the workspace / post-mortem: neither has a back arrow, so the device's Back returns to the list.
export async function backToDashboard() {
  if (q('project-workspace') || q('project-postmortem')) return deviceBack();
  return undefined;
}

export function installFakeGoogle(drive, behavior = {}) {
  const requests = [];
  window.google = {
    accounts: {
      id: { initialize: (cfg) => (behavior.idCfg = cfg), renderButton: (el) => (el.innerHTML = '<button type="button" data-testid="gsi-btn">Continue with Google</button>') },
      oauth2: {
        hasGrantedAllScopes: () => true,
        initTokenClient: (cfg) => ({
          requestAccessToken: ({ prompt }) => {
            requests.push(prompt);
            queueMicrotask(() => {
              if (behavior.block) cfg.error_callback?.({ type: 'popup_failed_to_open' });
              else if (prompt === 'none' && !behavior.silentOk) cfg.callback({ error: 'interaction_required' });
              else cfg.callback({ access_token: drive.token, expires_in: 3599 });
            });
          },
        }),
      },
    },
  };
  return requests;
}

export function createHost(App, props = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    host,
    mount: async (extra = {}) => {
      await act(async () => {
        root.render(React.createElement(App, { splash: { hold: 0, fade: 0 }, ...props, ...extra }));
        await new Promise((r) => setTimeout(r, 40));
      });
    },
    unmount: () => {
      if (host.isConnected) {
        act(() => root.unmount());
        host.remove();
      }
    },
    tab: (name) => [...host.querySelectorAll('nav button')].find((b) => b.textContent.includes(name)),
  };
}

/**
 * "Nuevo proyecto" opens the project screen on a DRAFT (nothing stored). This is what a thumb does to make it real: tap "Nuevo", type the name in the
 * header, tap "Guardar proyecto". A name is optional: without one the soft naming sheet appears and `name` is typed there. The paywall (free limit)
 * leaves the draft unopened and the function returns false.
 */
export async function createProjectViaDraft(name = 'Obra') {
  await click(q('fab-new'));
  if (!q('draft-bar')) return false;
  await setNative(q('ws-draft-name'), name);
  await click(q('draft-save'));
  await flush(60);
  return true;
}

// The draft that is already open (fab-new clicked): name it in the header and save it for good.
export async function saveDraftAs(name = 'Obra') {
  await setNative(q('ws-draft-name'), name);
  await click(q('draft-save'));
  await flush(60);
}
