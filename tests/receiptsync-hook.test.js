// @vitest-environment happy-dom
// The global sync hook: starts with the app, reacts to the network coming back, tells the user.
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createReceiptQueue } from '../src/lib/receiptQueue.js';
import { useReceiptSync } from '../src/lib/useReceiptSync.js';
import { systemNotify, askNotifyPermission } from '../src/lib/notify.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const JPEG = `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 300 }, (_, i) => i % 200)).toString('base64')}`;
const proxyOk = () => ({ ok: true, json: async () => ({ ok: true, isReceipt: true, currency: 'CLP', supplier: 'Sodimac', items: [{ description: 'Pintura', amountText: '$12.990', category: 'material' }] }) });

function Probe({ queue, apply, notify, fetchImpl }) {
  useReceiptSync({ queue, apply, notify, fetchImpl });
  return null;
}

describe('useReceiptSync', () => {
  it('drains on start when online, and again when the `online` event fires after being offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const queue = createReceiptQueue(null);
    await queue.enqueue({ projectId: 'proyecto01ab', image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es' });
    const fetchImpl = vi.fn(async () => proxyOk());
    const apply = vi.fn(async () => true);
    const notify = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Probe, { queue, apply, notify, fetchImpl }));
      await new Promise((r) => setTimeout(r, 40)); // start-up (recover + first drain attempt) settles inside act
    });
    expect(fetchImpl).not.toHaveBeenCalled(); // offline at start: nothing leaves the device
    expect(queue.peek()).toHaveLength(1);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 80)); // the whole drain (queue updates included) happens inside act
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ kind: 'receipt', currency: 'CLP' });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toBe('proyecto01ab');
    expect(apply.mock.calls[0][1][0]).toMatchObject({ description: 'Pintura', amount: 12990, supplier: 'Sodimac' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ key: 'q.done', tone: 'ok', params: { n: 1, lines: 1 } }));
    expect(queue.peek()).toHaveLength(0);
    act(() => root.unmount());
    host.remove();
  });
});

describe('system notification', () => {
  it('only when granted and the page is hidden; never throws without the API', () => {
    expect(systemNotify('t', 'b')).toBe(false); // no Notification API / not granted
    const made = [];
    globalThis.Notification = class {
      static permission = 'granted';
      constructor(title, o) {
        made.push([title, o.body]);
      }
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(systemNotify('CUBRAX', 'x')).toBe(false); // visible: the toast is enough
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    expect(systemNotify('CUBRAX', 'x')).toBe(true);
    expect(made).toEqual([['CUBRAX', 'x']]);
    delete globalThis.Notification;
    return expect(askNotifyPermission()).resolves.toBe(false);
  });
});
