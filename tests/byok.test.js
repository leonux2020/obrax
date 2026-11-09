// @vitest-environment happy-dom
// BYOK ("Bring Your Own Key") Scontrino IA: no server in the middle. The user's own Google AI Studio key lives only on the device,
// Ajustes has a quiet password field for it, opening "Boleta IA" without a key asks for it softly, the call goes straight to Google and
// the offline queue keeps working: a photo that cannot be read (no network, no key) is never lost.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { GeminiKeyField } from '../src/components/GeminiKey.jsx';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';
import { CSP_DIRECTIVES } from '../security/policy.js';
import { GEMINI_KEY_STORAGE, GEMINI_KEY_URL, cleanGeminiKey, clearGeminiKey, getGeminiKey, hasGeminiKey, maskGeminiKey, setGeminiKey } from '../src/lib/geminiKey.js';
import { callGemini, InvoiceError } from '../src/lib/gemini.js';
import { createReceiptQueue } from '../src/lib/receiptQueue.js';
import { BACKOFF, RETRYABLE, WAITING_FOR_USER, drainReceiptQueue } from '../src/lib/receiptSync.js';
import { useReceiptSync } from '../src/lib/useReceiptSync.js';
import { wipeLocalData } from '../src/lib/session.js';
import { newProject, toDayString } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { setSimulatedPro } from '../src/lib/pro.js';
import { CLIENT, q, click, flush, createHost } from './helpers/appHarness.js';
import { TEST_KEY, geminiError, geminiFetch, geminiReply, isGemini, seedKey } from './helpers/gemini.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JPEG = `data:image/jpeg;base64,/9j/${'A'.repeat(300)}`;
const RECEIPT = { isReceipt: true, currency: 'CLP', supplier: 'Sodimac', items: [{ description: 'Pintura', amountText: '$12.990', category: 'material' }] };

beforeEach(() => {
  localStorage.clear();
  clearGeminiKey();
  resetToasts();
  resetRegistry();
});
afterEach(() => {
  clearGeminiKey();
  vi.restoreAllMocks();
});

describe('1. the key store: only on this device, always sanitized', () => {
  it('cleanGeminiKey forgives spaces and quotes around a pasted key and rejects anything that cannot be a key', () => {
    expect(cleanGeminiKey(`  ${TEST_KEY}\n`)).toBe(TEST_KEY);
    expect(cleanGeminiKey(`"${TEST_KEY}"`)).toBe(TEST_KEY);
    for (const bad of ['', '   ', 'short', 'has spaces in the middle of the key 123456', '<script>alert(1)</script>0123456789', null, undefined, 42, {}, 'a'.repeat(300)]) expect(cleanGeminiKey(bad), String(bad)).toBe('');
  });

  it('set / get / has / clear / mask; a rejected value changes nothing', () => {
    expect(getGeminiKey()).toBe('');
    expect(hasGeminiKey()).toBe(false);
    expect(setGeminiKey('nope')).toBe('');
    expect(hasGeminiKey()).toBe(false);
    expect(setGeminiKey(` ${TEST_KEY} `)).toBe(TEST_KEY);
    expect(localStorage.getItem(GEMINI_KEY_STORAGE)).toBe(TEST_KEY);
    expect(getGeminiKey()).toBe(TEST_KEY);
    expect(setGeminiKey('')).toBe(''); // an empty paste never erases a saved key
    expect(getGeminiKey()).toBe(TEST_KEY);
    expect(maskGeminiKey(TEST_KEY)).toBe(`••••${TEST_KEY.slice(-4)}`);
    expect(maskGeminiKey('')).toBe('');
    clearGeminiKey();
    expect(localStorage.getItem(GEMINI_KEY_STORAGE)).toBeNull();
    expect(hasGeminiKey()).toBe(false);
  });

  it('a stored value that is not a key (tampered storage) reads as no key', () => {
    localStorage.setItem(GEMINI_KEY_STORAGE, '<img src=x onerror=alert(1)>');
    expect(getGeminiKey()).toBe('');
  });

  it('signing out wipes it (localStorage.clear()) and a stale in-memory copy never resurrects it', async () => {
    setGeminiKey(TEST_KEY);
    await wipeLocalData();
    expect(localStorage.getItem(GEMINI_KEY_STORAGE)).toBeNull();
    expect(getGeminiKey()).toBe('');
  });

  it('with no usable localStorage the key still serves this session (memory), and clearing removes it', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('denied'); } });
    try {
      expect(setGeminiKey(TEST_KEY)).toBe(TEST_KEY);
      expect(getGeminiKey()).toBe(TEST_KEY);
      clearGeminiKey();
      expect(getGeminiKey()).toBe('');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', real);
    }
  });

  it('it is never part of the Drive backup: the project / settings snapshots are whitelisted copies', async () => {
    setGeminiKey(TEST_KEY);
    const { collectBackup, serializeBackup } = await import('../src/lib/backup.js');
    const text = serializeBackup(await collectBackup({ settings: { region: 'CL', lang: 'es', geminiKey: TEST_KEY, apiKey: TEST_KEY }, company: {}, projects: [], loadPhotos: async () => [] }));
    expect(text).not.toContain(TEST_KEY);
  });
});

describe('2. the call: straight to Google, with the user key, nothing else involved', () => {
  it('the URL is Google\'s v1beta generateContent with the user key; the payload is systemInstruction + contents + generationConfig; no cookies', async () => {
    const f = vi.fn(async () => geminiReply(RECEIPT));
    const out = await callGemini({ kind: 'receipt', dataUrl: JPEG, currency: 'CLP', fetchImpl: f, apiKey: TEST_KEY });
    expect(out.supplier).toBe('Sodimac');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${TEST_KEY}`);
    expect(new URL(url).origin).toBe('https://generativelanguage.googleapis.com');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(['contents', 'generationConfig', 'systemInstruction']);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeTruthy();
    expect(body.systemInstruction.parts[0].text).toMatch(/\d{4}-\d{2}-\d{2}/); // the receipt prompt knows today's date
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
  });

  it('the stored key is used when none is passed; with none nothing is sent', async () => {
    const f = vi.fn(async () => geminiReply(RECEIPT));
    await expect(callGemini({ kind: 'receipt', dataUrl: JPEG, fetchImpl: f })).rejects.toMatchObject({ code: 'no_key' });
    expect(f).not.toHaveBeenCalled();
    setGeminiKey(TEST_KEY);
    await callGemini({ kind: 'receipt', dataUrl: JPEG, fetchImpl: f });
    expect(f.mock.calls[0][0]).toContain(`key=${TEST_KEY}`);
  });

  it('a stalled request ends as "timeout" instead of hanging the sheet', async () => {
    const stalled = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(callGemini({ kind: 'receipt', dataUrl: JPEG, fetchImpl: stalled, apiKey: TEST_KEY, attemptMs: 15, totalMs: 40 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('error codes the UI translates exist in six languages (no_key, bad_key included)', () => {
    for (const l of LANGS) for (const c of ['no_key', 'bad_key']) expect(DICT[l][`inv.err.${c}`], `${l}:${c}`).toBeTruthy();
    for (const l of LANGS) for (const k of ['settings.ai', 'gemini.field', 'gemini.placeholder', 'gemini.hint', 'gemini.save', 'gemini.remove', 'gemini.get', 'gemini.invalid', 'gemini.saved', 'gemini.sheet.title', 'gemini.sheet.body']) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
  });
});

describe('3. security: CSP, no proxy left, no key in the code', () => {
  it('connect-src allows exactly Google\'s Gemini origin in policy.js AND vercel.json (in sync)', () => {
    expect(CSP_DIRECTIVES['connect-src']).toContain('https://generativelanguage.googleapis.com');
    const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toMatch(/connect-src [^;]*https:\/\/generativelanguage\.googleapis\.com/);
    expect(vercel.functions).toBeUndefined(); // no serverless function any more
  });

  it('the server proxy is gone: no server/, api/ or dev-proxy plugin, nothing under src/ or the config mentions it', () => {
    for (const p of ['server', 'api', 'plugins/ai-proxy.js', 'tests/aiproxy.test.js']) expect(fs.existsSync(p), p).toBe(false);
    const config = fs.readFileSync('vite.config.js', 'utf8');
    expect(config).not.toMatch(/ai-proxy|aiProxy/);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk('src').filter((x) => /\.(js|jsx)$/.test(x))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\/api\/extract-invoice|geminiProxy/);
    expect(fs.readFileSync('.env.example', 'utf8')).not.toMatch(/^GEMINI_API_KEY=/m);
  });

  it('the real key of the developer is not in the source or in any test fixture', () => {
    const env = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
    const real = /GEMINI_API_KEY=(\S{20,})/.exec(env)?.[1];
    if (!real) return;
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of [...walk('src'), ...walk('tests'), 'vercel.json', 'README.md', '.env.example', 'security/policy.js']) expect(fs.readFileSync(f, 'utf8'), f).not.toContain(real);
  });
});

describe('4. Ajustes: a quiet password field for the key', () => {
  let h;
  afterEach(() => h?.unmount());
  const open = async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    const App = (await import('../src/App.jsx')).default;
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es', langLocked: true }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', phone: '', email: '' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    h = createHost(App);
    await h.mount();
    await click(q('nav-settings'));
    await click(q('settings-ops-summary'));
  };
  const typeKey = (value) =>
    act(async () => {
      const input = q('settings-gemini-key-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('it lives inside "Operaciones y sincronización" (no fourth accordion), is a password input and offers the link to create a free key', async () => {
    await open();
    const ai = q('settings-ai');
    expect(q('settings-ops').contains(ai)).toBe(true);
    const input = q('settings-gemini-key-input');
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    const link = q('settings-gemini-key-link');
    expect(link.getAttribute('href')).toBe(GEMINI_KEY_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(ai.textContent).toContain('Lectura con IA');
    expect(q('settings-gemini-key-save').disabled).toBe(true); // nothing typed: nothing to save
    expect(document.querySelectorAll('summary')).toHaveLength(3);
  });

  it('saving stores the clean key on the device, then only "••••xxxx" is shown (never the whole key) with a quiet remove', async () => {
    await open();
    await typeKey(`  ${TEST_KEY}  `);
    await click(q('settings-gemini-key-save'));
    expect(localStorage.getItem(GEMINI_KEY_STORAGE)).toBe(TEST_KEY);
    const saved = q('settings-gemini-key-saved');
    expect(saved.textContent).toContain(`••••${TEST_KEY.slice(-4)}`);
    expect(q('settings-ai').textContent).not.toContain(TEST_KEY);
    expect(q('settings-gemini-key-input')).toBeNull();
    await click(q('settings-gemini-key-remove'));
    expect(localStorage.getItem(GEMINI_KEY_STORAGE)).toBeNull();
    expect(q('settings-gemini-key-input')).not.toBeNull();
  });

  it('a pasted value that is not a key shows a soft message and stores nothing', async () => {
    await open();
    await typeKey('esto no es una clave valida de google');
    await click(q('settings-gemini-key-save'));
    expect(q('settings-gemini-key-invalid')).not.toBeNull();
    expect(localStorage.getItem(GEMINI_KEY_STORAGE)).toBeNull();
    await typeKey(TEST_KEY);
    expect(q('settings-gemini-key-invalid')).toBeNull(); // typing again clears the warning
  });

  it('OLED contract: no border / outline / grey background in the field, light type, accent at 90 %', () => {
    const src = fs.readFileSync('src/components/GeminiKey.jsx', 'utf8');
    expect(src).not.toMatch(/\bborder\b|border-|outline|bg-gray|bg-neutral-9|ring-/);
    expect(src).toContain('text-brand/90');
    expect(src).toContain('text-red-400/90');
    expect(src).toContain('active:scale-95');
  });

  it('standalone field: onSaved receives the clean key', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onSaved = vi.fn();
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(GeminiKeyField, { onSaved, testId: 'k' }))));
    await act(async () => {
      const input = host.querySelector('[data-testid="k-input"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, TEST_KEY);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSaved).toHaveBeenCalledWith(TEST_KEY);
    act(() => root.unmount());
    host.remove();
  });
});

describe('5. "Boleta IA" without a key: a soft request, then the normal sheet', () => {
  let host;
  let root;
  const day = (o) => {
    const d = new Date();
    d.setDate(d.getDate() + o);
    return toDayString(d);
  };
  function Harness({ initial }) {
    const [project, set] = useState(initial);
    const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
    const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
    return React.createElement(React.Fragment, null, React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, onBack: () => {}, onEdit: () => {}, onPro: () => {} }), React.createElement(ToastHost));
  }
  beforeEach(async () => {
    setSimulatedPro(true); // the AI scanner is a PRO feature: this user has it
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const p = newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana', startDate: day(-5), endDate: day(20) });
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: p }))));
    await flush();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('no key: tapping the dock opens the soft key sheet with the free-key link, not the receipt sheet', async () => {
    await click(q('dock-scan'));
    expect(q('gemini-key-sheet')).not.toBeNull();
    expect(q('receipt-sheet')).toBeNull();
    const link = q('gemini-sheet-key-link');
    expect(link.getAttribute('href')).toBe('https://aistudio.google.com/apikey');
    expect(q('gemini-sheet-key-input').type).toBe('password');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('saving the key swaps the request for the receipt sheet in place', async () => {
    await click(q('dock-scan'));
    await act(async () => {
      const input = q('gemini-sheet-key-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, TEST_KEY);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(q('gemini-sheet-key-save'));
    await flush(30);
    expect(q('gemini-key-sheet')).toBeNull();
    expect(q('receipt-sheet')).not.toBeNull();
    expect(getGeminiKey()).toBe(TEST_KEY);
  });

  it('with a key saved the receipt sheet opens straight away (no request)', async () => {
    seedKey();
    await click(q('dock-scan'));
    expect(q('gemini-key-sheet')).toBeNull();
    expect(q('receipt-sheet')).not.toBeNull();
  });

  it('closing the request closes the feature (the device Back, like every sheet)', async () => {
    await click(q('dock-scan'));
    expect(q('gemini-key-sheet')).not.toBeNull();
    await act(async () => {
      window.history.back();
    });
    await flush(30);
    expect(q('gemini-key-sheet')).toBeNull();
    expect(q('receipt-sheet')).toBeNull();
  });
});

describe('6. offline resilience: a photo that cannot be read is never lost', () => {
  const rowOf = (queue) => queue.enqueue({ projectId: 'proyecto01ab', image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es' });

  it('network failure toward Google: the photo stays queued (pending, +1 attempt) and nothing is applied', async () => {
    seedKey();
    const queue = createReceiptQueue(null);
    await rowOf(queue);
    const apply = vi.fn(async () => true);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const res = await drainReceiptQueue({ queue, apply, fetchImpl, online: () => true });
    expect(apply).not.toHaveBeenCalled();
    expect(res.done).toHaveLength(0);
    const [row] = queue.peek();
    expect(row).toMatchObject({ status: 'pending', lastError: 'network', attempts: 1 });
    expect(await queue.imageOf(row)).toBe(JPEG); // the photo itself is intact
  });

  it('Google answers later: the same photo is read from the queue and lands in its project', async () => {
    seedKey();
    const queue = createReceiptQueue(null);
    await rowOf(queue);
    const apply = vi.fn(async () => true);
    const fetchImpl = vi.fn(async () => geminiReply(RECEIPT));
    const res = await drainReceiptQueue({ queue, apply, fetchImpl, online: () => true, force: true });
    expect(res.done).toHaveLength(1);
    expect(apply.mock.calls[0][0]).toBe('proyecto01ab');
    expect(apply.mock.calls[0][1][0]).toMatchObject({ description: 'Pintura', amount: 12990 });
    expect(queue.peek()).toHaveLength(0);
  });

  it('no key: nothing is sent, the photo waits WITHOUT burning an attempt and the row never turns "failed"', async () => {
    const queue = createReceiptQueue(null);
    await rowOf(queue);
    const apply = vi.fn(async () => true);
    const fetchImpl = vi.fn(async () => geminiReply(RECEIPT));
    for (let i = 0; i < 12; i += 1) await drainReceiptQueue({ queue, apply, fetchImpl, online: () => true, force: true }); // more than maxAttempts
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(queue.peek()[0]).toMatchObject({ status: 'pending', lastError: 'no_key', attempts: 0 });
    expect(queue.peek()[0].nextAt).toBeGreaterThan(Date.now() + BACKOFF.maxMs - 5000);
    expect(RETRYABLE).toEqual(expect.arrayContaining(WAITING_FOR_USER));
  });

  it('a key Google rejects waits for the user the same way (attempts untouched); a good key later reads it', async () => {
    seedKey();
    const queue = createReceiptQueue(null);
    await rowOf(queue);
    const apply = vi.fn(async () => true);
    const denied = vi.fn(async () => geminiError(403, 'x', 'PERMISSION_DENIED'));
    await drainReceiptQueue({ queue, apply, fetchImpl: denied, online: () => true, force: true });
    expect(queue.peek()[0]).toMatchObject({ status: 'pending', lastError: 'bad_key', attempts: 0 });
    const fine = vi.fn(async () => geminiReply(RECEIPT));
    await drainReceiptQueue({ queue, apply, fetchImpl: fine, online: () => true, force: true });
    expect(queue.peek()).toHaveLength(0);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('saving a key in Ajustes wakes the waiting photos at once (no need to wait for the retry timer)', async () => {
    const queue = createReceiptQueue(null);
    await rowOf(queue);
    const apply = vi.fn(async () => true);
    const notify = vi.fn();
    const fetchImpl = vi.fn(geminiFetch(async () => geminiReply(RECEIPT)));
    function Probe() {
      useReceiptSync({ queue, apply, notify, fetchImpl });
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Probe));
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(fetchImpl).not.toHaveBeenCalled(); // no key yet
    expect(queue.peek()[0]).toMatchObject({ status: 'pending', lastError: 'no_key' });
    await act(async () => {
      setGeminiKey(TEST_KEY);
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isGemini(fetchImpl.mock.calls[0][0])).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ key: 'q.done', tone: 'ok' }));
    expect(queue.peek()).toHaveLength(0);
    act(() => root.unmount());
    host.remove();
  });

  it('InvoiceError carries the stable codes the queue and the sheets rely on', () => {
    expect(new InvoiceError('no_key').code).toBe('no_key');
    expect(new InvoiceError('bad_key').code).toBe('bad_key');
  });
});
