// Shared helpers for the app-level Drive tests: DOM helpers + a fake Google Identity Services (token client)
// wired to the fake Drive.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const CLIENT = 'test-client-123.apps.googleusercontent.com';
export const q = (id) => document.querySelector(`[data-testid="${id}"]`);
export const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
export const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
export const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

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
