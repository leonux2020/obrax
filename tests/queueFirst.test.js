// @vitest-environment happy-dom
// QUEUE-FIRST scanner (fire-and-forget): the sheet only stores the photo; the background worker (receiptSync.js) is the ONLY one that calls Gemini.
//   - good read  -> the expenses land in the project, the row disappears;
//   - bad read   -> the row stays in the list of pending receipts, with its error, for the user to review later;
//   - photos taken while the worker runs are read by the same run (burst scanning);
//   - nothing in the sheet is a "Lettura della fattura..." screen any more.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import QueueList from '../src/components/workspace/QueueList.jsx';
import { InvoiceError } from '../src/lib/gemini.js';
import { createReceiptQueue } from '../src/lib/receiptQueue.js';
import { drainReceiptQueue } from '../src/lib/receiptSync.js';
import { getToasts, resetToasts } from '../src/lib/notify.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IMG = 'data:image/jpeg;base64,/9j/AAAA';
const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de'];
const answer = (amount = 1000) => ({ isReceipt: true, receipts: [{ supplier: 'Sodimac', currency: 'CLP', date: '2026-10-29', total: amount, items: [{ description: 'Cemento', amount, category: 'material' }] }] });

describe('worker: the call to Gemini belongs to the background sync only', () => {
  let queue;
  const apply = vi.fn(async () => true);
  const park = (n) => Promise.all(Array.from({ length: n }, (_, i) => queue.enqueue({ projectId: 'proyecto01', image: IMG, currency: 'CLP', lang: 'es', now: 1 + i })));
  beforeEach(() => {
    queue = createReceiptQueue();
    apply.mockClear();
  });

  it('a good read: pending -> expenses applied to the project -> the row is gone', async () => {
    await park(1);
    const request = vi.fn(async () => answer(2500));
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toBe('proyecto01');
    expect(apply.mock.calls[0][1][0]).toMatchObject({ amount: 2500 });
    expect(res.done).toHaveLength(1);
    expect(await queue.list()).toHaveLength(0);
  });

  it('a bad read (blurry photo / not a receipt): the row STAYS, failed, with the reason; the other photos are still read', async () => {
    await park(3);
    let n = 0;
    const request = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new InvoiceError('unreadable');
      return answer();
    });
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    expect(res.done).toHaveLength(2);
    expect(res.failed).toHaveLength(1);
    const rows = await queue.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', lastError: 'unreadable' });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('BURST: a photo taken while the worker is busy is read by the same run (no second wake-up needed)', async () => {
    await park(1);
    let late = false;
    const request = vi.fn(async () => {
      if (!late) {
        late = true;
        await queue.enqueue({ projectId: 'proyecto01', image: IMG, currency: 'CLP', lang: 'es', now: 5 }); // the user keeps photographing meanwhile
      }
      return answer();
    });
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(res.done).toHaveLength(2);
    expect(await queue.list()).toHaveLength(0);
  });

  it('a row is processed ONCE per run: a failure that waits for its retry is not hammered by the extra pass', async () => {
    await park(2);
    const request = vi.fn(async () => {
      throw new InvoiceError('upstream');
    });
    await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => 10_000 });
    expect(request).toHaveBeenCalledTimes(1); // the line is bad: the rest wait for the same retry
    const rows = await queue.list();
    expect(rows.every((r) => r.status === 'pending' && r.nextAt > 10_000)).toBe(true);
  });

  it('losing the connection mid-run ends the run without extra passes', async () => {
    await park(2);
    let on = true;
    const request = vi.fn(async () => {
      on = false;
      return answer();
    });
    await drainReceiptQueue({ queue, apply, request, online: () => on, now: () => 10_000 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(await queue.list()).toHaveLength(1); // the second one waits (pending) for the connection
  });
});

describe('the list of pending receipts: quiet states, and the reason of a failed one', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const render = (rows, lang = 'es') => act(async () => root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(QueueList, { rows, onRetry() {}, onDiscard() {}, onAccept() {} }))));
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('pending = "en cola · se procesa en segundo plano"; offline = waiting for the connection; failed = what went wrong, quietly', async () => {
    await render([
      { id: 'a1', status: 'pending', createdAt: 1 },
      { id: 'a2', status: 'pending', lastError: 'network', createdAt: 1 },
      { id: 'a3', status: 'failed', lastError: 'unreadable', createdAt: 1 },
      { id: 'a4', status: 'failed', lastError: 'not_invoice', createdAt: 1 },
      { id: 'a5', status: 'failed', lastError: 'something_new', createdAt: 1 }, // unknown code: no raw key is ever shown
    ]);
    expect(q('queued-a1').textContent).toContain('En cola · se procesa en segundo plano');
    expect(q('queued-a1').textContent).not.toContain('conexión');
    expect(q('queued-a2').textContent).toContain('Pendiente de conexión');
    expect(q('queued-why-a1')).toBeNull();
    expect(q('queued-a3').textContent).toContain('No se pudo leer');
    expect(q('queued-why-a3').textContent).toMatch(/Acércate y mejora la luz/);
    expect(q('queued-why-a4').textContent.length).toBeGreaterThan(10);
    expect(q('queued-why-a5')).toBeNull();
    expect(q('queued-retry-a3')).not.toBeNull(); // the user can retry / discard later
    expect(q('queued-discard-a3')).not.toBeNull();
    expect(host.textContent).not.toMatch(/inv\.err\./);
  });
});

describe('the sheet: no long "reading" state in the main flow', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const prepare = async () => ({ dataUrl: IMG, width: 1, height: 1 });
  const pick = async (id = 'receipt-camera-input') => {
    const input = q(id);
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
  };
  const mount = (props, lang = 'es') => act(async () => root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(ReceiptSheet, { onSave: () => {}, onClose: () => {}, prepareImage: prepare, ...props }))));
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    resetToasts();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('camera AND gallery upload follow the same path: stored, never awaited, never "reading"', async () => {
    const onQueue = vi.fn(async () => {});
    await mount({ onQueue, fetchImpl: vi.fn() });
    await pick('receipt-camera-input');
    await pick('receipt-file-input');
    expect(onQueue).toHaveBeenCalledTimes(2);
    expect(q('receipt-reading')).toBeNull();
    expect(host.textContent).not.toMatch(/leyendo|reading|lettura/i);
  });

  it('the toast text exists in the six languages and says "background"', () => {
    const expected = {
      es: 'Guardada. Procesando en segundo plano...',
      en: 'Saved. Processing in the background...',
      pt: 'Guardada. Processando em segundo plano...',
      fr: 'Enregistré. Traitement en arrière-plan...',
      it: 'Salvato. Elaborazione in background...',
      de: 'Gespeichert. Verarbeitung im Hintergrund...',
    };
    for (const lang of LANGS) {
      const t = makeI18n(lang, 'CL').t;
      expect(t('q.saved'), lang).toBe(expected[lang]);
      expect(t('q.savedCount', { n: 3 }), lang).toMatch(/3/);
      for (const key of ['q.pending', 'q.pending.net', 'q.pending.rate']) expect(t(key), `${lang} ${key}`).not.toBe(key);
    }
  });

  it('the sheet shows the toast tone "ok" (green) and the text is the one of the dictionary', async () => {
    await mount({ onQueue: vi.fn(async () => {}) }, 'it');
    await pick();
    expect(getToasts().at(-1)).toMatchObject({ key: 'q.saved', tone: 'ok' });
    expect(q('receipt-saved').textContent).toContain('Salvato. Elaborazione in background...');
  });

  it('an unreadable file never leaves the screen blocked: the error is shown and the camera stays usable', async () => {
    const bad = vi.fn(async () => {
      throw new Error('boom');
    });
    await mount({ onQueue: vi.fn(async () => {}), prepareImage: bad });
    await pick();
    expect(q('receipt-error').dataset.code).toBe('upstream');
    expect(q('receipt-camera')).not.toBeNull();
  });
});
