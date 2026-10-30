// @vitest-environment happy-dom
// "Silent or abort": nothing automatic (boot, background worker, 401 renewal, drain of the offline queue) may open a Google window.
// Only a tap of the user ("Enviar a Drive", "Reconectar Drive") asks with a visible prompt, and the screen shows it is busy.
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { requestDriveAccess, ensureDriveToken } from '../src/lib/auth.js';
import { DriveError } from '../src/lib/drive.js';
import {
  clearDriveNeedsInteraction,
  clearDriveToken,
  getDriveToken,
  needsDriveInteraction,
  resetDriveAuthState,
  setDriveToken,
  subscribeDriveAuth,
} from '../src/lib/driveToken.js';
import { createExportQueue } from '../src/lib/exportQueue.js';
import { deliverRendition, drainExportQueue } from '../src/lib/exportSync.js';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { newProject } from '../src/lib/projects.js';
import ProjectFinancialDashboard from '../src/components/ProjectFinancialDashboard.jsx';

globalThis.Blob = NodeBlob;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fakeGsi = (answer) => {
  const calls = [];
  const gsi = {
    accounts: {
      oauth2: {
        hasGrantedAllScopes: () => true,
        initTokenClient: (cfg) => ({
          requestAccessToken: (opts) => {
            calls.push(opts.prompt);
            queueMicrotask(() => answer(cfg, opts));
          },
        }),
      },
    },
  };
  return { gsi, calls };
};
const ask = (gsi, prompt) => requestDriveAccess({ enabled: true, load: async () => gsi, prompt });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetDriveAuthState();
});

describe('requestDriveAccess: silent mode has no way to a visible window', () => {
  it.each(['interaction_required', 'consent_required', 'login_required', 'access_denied'])('Google answers "%s" to prompt:none -> rejects interaction_required (abort)', async (error) => {
    const { gsi, calls } = fakeGsi((cfg) => cfg.callback({ error }));
    await expect(ask(gsi, 'none')).rejects.toMatchObject({ code: 'interaction_required' });
    expect(calls).toEqual(['none']); // one request, only silent, no second attempt
  });

  it('a pop-up that cannot open / closes in silent mode is "interaction_required", NEVER "popup" (which the callers answer with a redirect)', async () => {
    for (const type of ['popup_failed_to_open', 'popup_closed', 'unknown']) {
      const { gsi } = fakeGsi((cfg) => cfg.error_callback({ type }));
      await expect(ask(gsi, 'none')).rejects.toMatchObject({ code: 'interaction_required' });
    }
  });

  it('a silent request that never answers gives up (timeout)', async () => {
    const { gsi } = fakeGsi(() => {});
    await expect(requestDriveAccess({ enabled: true, load: async () => gsi, prompt: 'none', silentTimeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('the interactive (tap) request keeps its behaviour: popup_failed_to_open stays "popup" so the tap can use the redirect', async () => {
    const { gsi, calls } = fakeGsi((cfg) => cfg.error_callback({ type: 'popup_failed_to_open' }));
    await expect(ask(gsi, '')).rejects.toMatchObject({ code: 'popup' });
    expect(calls).toEqual(['']);
  });
});

describe('ensureDriveToken: silent or abort, remembered until a tap', () => {
  it('interaction_required: resolves null, marks "needs interaction" and does not ask again by itself', async () => {
    const request = vi.fn(async () => {
      throw new DriveError('interaction_required');
    });
    expect(await ensureDriveToken({ interactive: false, request })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].prompt).toBe('none');
    expect(needsDriveInteraction()).toBe(true);
    for (let i = 0; i < 3; i += 1) expect(await ensureDriveToken({ interactive: false, request })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1); // aborted quietly: no request at all, no flash
  });

  it('the flag survives a reload (it is persisted) and notifies the screens', async () => {
    const seen = vi.fn();
    const off = subscribeDriveAuth(seen);
    await ensureDriveToken({ interactive: false, request: async () => { throw new DriveError('interaction_required'); } });
    expect(seen).toHaveBeenCalled();
    off();
    resetDriveAuthState(); // "the page was reloaded": the in-memory copy is gone
    expect(needsDriveInteraction()).toBe(true);
  });

  it('offline / not configured are transient: no flag, the next silent try is allowed', async () => {
    for (const code of ['offline', 'not_configured']) {
      const request = vi.fn(async () => { throw new DriveError(code); });
      expect(await ensureDriveToken({ interactive: false, request })).toBeNull();
      expect(needsDriveInteraction()).toBe(false);
    }
  });

  it('a tap (interactive) is still allowed to ask with a visible prompt, and a token clears the flag', async () => {
    await ensureDriveToken({ interactive: false, request: async () => { throw new DriveError('interaction_required'); } });
    expect(needsDriveInteraction()).toBe(true);
    const request = vi.fn(async ({ prompt }) => {
      expect(prompt).toBe(''); // visible consent
      setDriveToken('tok_abcdefghij', 3600);
    });
    expect(await ensureDriveToken({ interactive: true, request })).toBe('tok_abcdefghij');
    expect(needsDriveInteraction()).toBe(false);
    expect(getDriveToken()).toBe('tok_abcdefghij');
  });

  it('a user who closes the window of a tap does not poison the silent path', async () => {
    const request = vi.fn(async () => { throw new DriveError('denied'); });
    expect(await ensureDriveToken({ interactive: true, request })).toBeNull();
    expect(needsDriveInteraction()).toBe(false);
  });

  it('an already valid token is used without asking anything', async () => {
    setDriveToken('tok_valid_123456', 3600);
    const request = vi.fn();
    expect(await ensureDriveToken({ interactive: false, request })).toBe('tok_valid_123456');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('who may ask visibly: the offline queue', () => {
  const file = { fileName: 'Rendicion_2026-10-30.xlsx', bytes: Uint8Array.from([80, 75, 3, 4]) };
  it('the background drain asks its token with interactive:false (silent), the tap of "Enviar a Drive" with interactive:true', async () => {
    const queue = createExportQueue();
    await queue.enqueue({ projectId: 'proyecto01', title: 'Casa', fileName: file.fileName, blob: new Blob([file.bytes]), now: 1 });
    const bg = vi.fn(async () => null);
    await drainExportQueue({ queue, upload: vi.fn(), ensureToken: bg, online: () => true });
    expect(bg).toHaveBeenCalledWith({ interactive: false });

    const tap = vi.fn(async () => 'tok');
    await deliverRendition({ file, project: { id: 'proyecto02', title: 'B' }, upload: async () => {}, ensureToken: tap, queue: createExportQueue(), online: () => true });
    expect(tap).toHaveBeenCalledWith({ interactive: true });
  });

  it('with no Google session in the background the files simply wait (nothing opened, nothing lost)', async () => {
    const queue = createExportQueue();
    await queue.enqueue({ projectId: 'proyecto01', title: 'Casa', fileName: file.fileName, blob: new Blob([file.bytes]), now: 1 });
    const upload = vi.fn();
    await drainExportQueue({ queue, upload, ensureToken: async () => null, online: () => true });
    expect(upload).not.toHaveBeenCalled();
    expect(await queue.list()).toHaveLength(1);
  });
});

describe('ProjectFinancialDashboard: "Reconectar Drive" is the user-driven way back', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const mount = async (props) => {
    const queue = createExportQueue();
    await queue.enqueue({ projectId: props.project.id, title: 'Casa', fileName: 'Rendicion_2026-10-30.xlsx', blob: new Blob([Uint8Array.from([80, 75, 3, 4])]), now: 1 });
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ProjectFinancialDashboard, { onChange: () => {}, onBack: () => {}, onCloseRendition: async () => {}, queue, ...props }))));
    await flush(20);
  };
  const project = newProject({ regionCode: 'CL', name: 'Casa', now: 1000 });

  it('needsReconnect: the queued strip offers "Reconectar Drive" instead of a silent retry', async () => {
    await mount({ project, needsReconnect: true, onReconnect: async () => {}, onRetryQueue: () => {} });
    expect(q('fin-reconnect').textContent).toBe('Reconectar Drive');
    expect(q('fin-queued-retry')).toBeNull();
  });

  it('without the flag the usual retry stays', async () => {
    await mount({ project, needsReconnect: false, onReconnect: async () => {}, onRetryQueue: () => {} });
    expect(q('fin-reconnect')).toBeNull();
    expect(q('fin-queued-retry')).not.toBeNull();
  });

  it('the tap shows the busy state while the Google window is open, then releases (also when it fails or hangs)', async () => {
    let finish;
    await mount({ project, needsReconnect: true, onReconnect: () => new Promise((r) => { finish = r; }) });
    await act(async () => q('fin-reconnect').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(q('fin-reconnect').disabled).toBe(true);
    expect(q('fin-reconnect').textContent).toBe('Conectando con Google…');
    await act(async () => finish('tok'));
    expect(q('fin-reconnect').disabled).toBe(false);
    expect(q('fin-reconnect').textContent).toBe('Reconectar Drive');

    act(() => root.unmount());
    root = createRoot(host);
    await mount({ project, needsReconnect: true, onReconnect: async () => { throw new Error('closed'); } });
    await act(async () => q('fin-reconnect').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush(10);
    expect(q('fin-reconnect').disabled).toBe(false);

    act(() => root.unmount());
    root = createRoot(host);
    await mount({ project, needsReconnect: true, onReconnect: () => new Promise(() => {}), watchdogMs: 30 });
    await act(async () => q('fin-reconnect').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(q('fin-reconnect').disabled).toBe(true);
    await flush(60);
    expect(q('fin-reconnect').disabled).toBe(false);
  });
});

describe('audit of the call sites: automatic code never asks visibly', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
  it('sign-in follow-up, sign-out flush and the post-connect backup are silent', () => {
    expect(app).not.toMatch(/offerRef\.current\?\.\(\{ interactive: true/);
    expect(app).not.toMatch(/sync\.flush\(\{ force: true, interactive: true \}\)/);
  });
  it('every interactive request comes from a user handler: send to Drive, reconnect, back up now, restore, sync dossier', () => {
    const lines = app.split('\n').filter((l) => /interactive: true/.test(l));
    const allowed = [/ensureDriveToken\(\{ interactive: true/, /interactive = true/, /restoreFromDrive\(\{ interactive: true \}\)/, /override: true/];
    for (const l of lines) expect(allowed.some((re) => re.test(l)), l.trim()).toBe(true);
  });
});
