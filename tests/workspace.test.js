// @vitest-environment happy-dom
// ProjectWorkspace: the single-screen project (3 zones), the on-screen price pad, frozen prices, the dock and the
// offline receipt path. Plus the pure model behind it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { newProject, toDayString } from '../src/lib/projects.js';
import { computeAll } from '../src/lib/engine.js';
import { padInit, padReduce, padValue, padDisplay } from '../src/lib/numpad.js';
import { STATE_TONE, headerModel, partidaGroups, quoteLock, timeProgress, unlockQuote, withPriceOverride, workspaceReducer, initialWorkspaceState, workspaceState } from '../src/lib/workspaceModel.js';
import { LEVEL_COLOR } from '../src/components/levelStyle.js';
import { currentBook, resetRegistry } from '../src/lib/priceRegistry.js';
import { flushUserPrices } from '../src/lib/priceFeed.js';
import { priceStore } from '../src/lib/priceStore.js';
import { resetToasts } from '../src/lib/notify.js';
import { freezeQuote } from '../src/lib/signature.js';
import { InvoiceError } from '../src/lib/invoice.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};
const mk = (extra = {}, start = -5, end = 20) => {
  const p = newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana', startDate: day(start), endDate: day(end), location: { lat: -33.45, lng: -70.66, label: 'Providencia' } });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  return { ...p, ...extra };
};

describe('model: state, progress, lock, price override', () => {
  it('the four states map to blue / green / orange / red and a finished job to grey', () => {
    expect(workspaceState(mk({}, 5, 30)).level).toBe('future');
    expect(workspaceState(mk({}, -5, 60)).level).toBe('green');
    expect(workspaceState(mk({}, -10, 2)).level).toBe('orange');
    const late = workspaceState(mk({}, -30, -4));
    expect(late.level).toBe('red');
    expect(late.info.daysLate).toBe(4);
    expect(workspaceState(mk({ closedAt: Date.now() })).level).toBe('closed');
    expect(STATE_TONE).toMatchObject({ future: LEVEL_COLOR.future, green: LEVEL_COLOR.green, orange: LEVEL_COLOR.orange, red: LEVEL_COLOR.red });
  });

  it('time progress: elapsed / total days, nothing without dates', () => {
    const p = mk({}, -5, 5);
    expect(timeProgress(p)).toMatchObject({ elapsed: 5, total: 10, pct: 50 });
    expect(timeProgress(mk({}, 3, 13)).pct).toBe(0);
    expect(timeProgress({ ...p, endDate: '' }).pct).toBeNull();
  });

  it('a frozen or signed quote is locked; unlocking drops the freeze AND the signature, nothing else', () => {
    const open = mk();
    expect(quoteLock(open.draft)).toBeNull();
    const frozen = freezeQuote(open.draft, { pricedAt: 1000, total: 5, live: open });
    expect(quoteLock(frozen)).toBe('frozen');
    expect(quoteLock({ ...frozen, signature: { dataUrl: 'x' } })).toBe('signed');
    const released = unlockQuote({ ...frozen, signature: { dataUrl: 'x' } });
    expect(released.frozen).toBeNull();
    expect(released.signature).toBeNull();
    expect(released.partidas).toBe(frozen.partidas);
    expect(unlockQuote(open.draft)).toBe(open.draft);
  });

  it('withPriceOverride sets / clears a price, ignores junk and REFUSES while locked', () => {
    const d = mk().draft;
    expect(withPriceOverride(d, 'cement_bag', 7000).overrides.cement_bag).toBe(7000);
    expect(withPriceOverride(withPriceOverride(d, 'cement_bag', 7000), 'cement_bag', null).overrides).toEqual({});
    expect(withPriceOverride(d, 'cement_bag', -3)).toBe(d);
    expect(withPriceOverride(d, 'cement_bag', 'x')).toBe(d);
    const frozen = freezeQuote(d, { pricedAt: 1000, total: 5, live: {} });
    expect(withPriceOverride(frozen, 'cement_bag', 7000)).toBe(frozen);
  });

  it('partidaGroups: every material line is split by share and adds up to the quote', () => {
    const p = mk();
    p.draft.mode = 'project';
    const result = computeAll(p.draft, Date.now(), { chains: false });
    const groups = partidaGroups(result, p.draft);
    expect(groups).toHaveLength(1);
    const sum = groups[0].rows.reduce((s, r) => s + r.total, 0);
    expect(sum).toBeCloseTo(result.quote.materials, 0);
    expect(groups[0].rows.every((r) => ['user', 'ai', 'base'].includes(r.origin))).toBe(true);
    expect(groups[0].amount).toBeGreaterThan(0);
  });

  it('header model: total + the two bars; screen reducer opens one thing at a time', () => {
    const p = mk({ payments: [{ id: 'abcd', amount: 100, at: 1, note: '' }] });
    const h = headerModel({ project: p, total: 400, valid: true, cash: { pct: 25, paid: 100, pending: 300 }, now: Date.now() });
    expect(h.total).toBe(400);
    expect(h.bars.map((b) => b.id)).toEqual(['time', 'cash']);
    expect(h.bars[1].pct).toBe(25);
    let s = initialWorkspaceState();
    s = workspaceReducer(s, { type: 'openPad', kind: 'material', id: 'sand' });
    expect(s.pad.id).toBe('sand');
    s = workspaceReducer(s, { type: 'sheet', name: 'export' });
    expect(s.sheet).toBe('export');
    expect(s.pad).toBeNull(); // opening a sheet closes the pad
    expect(workspaceReducer(s, { type: 'sheet', name: 'nonsense' }).sheet).toBeNull();
    expect(workspaceReducer(s, { type: 'toggle', id: 'a' }).open.a).toBe(true);
  });
});

describe('numpad (pure)', () => {
  const type = (state, keys) => [...keys].reduce((s, k) => padReduce(s, k === '.' ? { type: 'dot' } : k === '<' ? { type: 'back' } : { type: 'digit', digit: k }), state);
  it('the first digit replaces the current value, then it appends; decimals are bounded; no leading zeros', () => {
    let s = padInit(4500, 2);
    expect(s.text).toBe('4500');
    s = type(s, '7');
    expect(s.text).toBe('7');
    s = type(s, '25.5');
    expect(s.text).toBe('725.5');
    s = type(s, '55');
    expect(s.text).toBe('725.55'); // 2 decimals max
    expect(padValue(s)).toBe(725.55);
    expect(type(padInit(null, 0), '.5').text).toBe('5'); // no decimals for CLP-like regions
    expect(type(padInit(null, 2), '007').text).toBe('7');
    expect(type(padInit(null, 2), '.').text).toBe('0.');
    expect(padValue(padInit(null, 2))).toBeNull();
    expect(padValue({ text: '0', decimals: 2 })).toBeNull();
    expect(type(padInit(12, 2), '<').text).toBe('1');
  });
  it('shows the region separator', () => {
    expect(padDisplay({ text: '1234.5' }, 'es-CL')).toBe('1.234,5');
    expect(padDisplay({ text: '1234.5' }, 'en-US')).toBe('1,234.5');
    expect(padDisplay({ text: '' }, 'en-US')).toBe('0');
  });
});

// ---- the screen -------------------------------------------------------------------------------------------------------------------
let host;
let root;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...host.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

function Harness({ initial, receipts, enqueueReceipt, onPro = () => {}, spy }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy && (spy.project = project);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts, enqueueReceipt, onBack: () => {}, onEdit: () => {}, onPro }),
    React.createElement(ToastHost)
  );
}
const mount = async (props) => {
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, props)));
  });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ProjectWorkspace: three zones', () => {
  it('Zone A shows name, client, place, traffic light with days, total and bars; colour only as left border / lettering', async () => {
    await mount({ initial: mk({}, -30, -4) });
    expect(q('ws-zone-a')).not.toBeNull();
    expect(q('ws-title').textContent).toBe('Casa Pérez');
    expect(q('ws-zone-a').textContent).toContain('Ana');
    expect(q('ws-location').textContent).toBe('Providencia');
    const st = q('ws-status');
    expect(st.getAttribute('data-level')).toBe('red');
    expect(st.textContent).toContain('4');
    expect(st.style.borderLeftColor).not.toBe('');
    expect(st.className).toMatch(/border-l-2/);
    expect(st.className).not.toMatch(/\bbg-/); // zero solid fills for states
    expect(q('ws-total').textContent).toMatch(/\d/);
    expect(q('bar-time').getAttribute('data-pct')).toBe('100');
    expect(q('ws-zone-a').className).toMatch(/sticky/);
    expect(q('ws-zone-a').className).toContain('bg-black'); // pure OLED black, the same as the app theme
    expect(q('project-workspace').className).toContain('bg-black');
    expect(q('project-workspace').className).toContain('text-[#E0E0E0]');
  });

  it('Zone B: partidas are native <details>/<summary> accordions with their materials inside', async () => {
    await mount({ initial: mk() });
    const det = q('partida-0');
    expect(det.tagName).toBe('DETAILS');
    expect(q('partida-summary-0').tagName).toBe('SUMMARY');
    expect(q('partida-summary-0').textContent).toMatch(/\d/); // the partida's money
    expect(qa('materials-0')).toHaveLength(1);
    expect(q('materials-0').querySelectorAll('[data-testid^="price-"]').length).toBeGreaterThan(2);
  });

  it('Zone C: dock with Bitácora, Cámara, Boleta IA and Exportar', async () => {
    await mount({ initial: mk() });
    expect(['log', 'camera', 'scan', 'export'].map((k) => !!q(`dock-${k}`))).toEqual([true, true, true, true]);
    expect(q('ws-zone-c').className).toMatch(/fixed inset-x-0 bottom-0/);
    await click(q('dock-export'));
    expect(['client', 'tech', 'xlsx'].map((k) => !!q(`export-${k}`))).toEqual([true, true, true]);
    expect(q('export-client').textContent).toMatch(/Cliente/);
    expect(q('export-tech').textContent).toMatch(/Contratista/);
    expect(q('export-xlsx').textContent).toMatch(/Rendición/);
  });
});

describe('prices: own numpad, instant recalculation, saved as the user standard', () => {
  it('tapping a price opens the pad (no OS keyboard); typing updates the project and the total at once, and saves the standard price', async () => {
    const spy = {};
    await mount({ initial: mk(), spy });
    const before = q('ws-total').textContent;
    const row = q('materials-0').querySelector('[data-testid="price-cement_bag"]');
    expect(row).not.toBeNull();
    await click(row);
    expect(q('price-numpad')).not.toBeNull();
    expect(host.querySelector('input[type="number"]:focus, input[type="text"]:focus')).toBeNull();
    for (const k of ['9', '9', '0', '0']) await click(q(`pad-${k}`));
    expect(q('pad-display').getAttribute('data-value')).toBe('9900');
    expect(spy.project.draft.overrides.cement_bag).toBe(9900); // the project follows
    expect(q('ws-total').textContent).not.toBe(before); // computeAll ran again
    expect(currentBook('CL')?.user?.materials?.cement_bag).toBe(9900); // the user's price book follows
    await click(q('pad-done'));
    await flushUserPrices();
    expect((await priceStore.load('CL'))?.user?.materials?.cement_bag).toBe(9900); // and it is persisted (IndexedDB / fallback)
    expect(q('price-cement_bag').textContent).toContain('9.900');
    expect(q('price-cement_bag').getAttribute('data-origin')).toBe('user');
  });

  it('"Restablecer" in the pad returns the material to the book / base price', async () => {
    const spy = {};
    await mount({ initial: mk(), spy });
    await click(q('price-cement_bag'));
    await click(q('pad-5'));
    expect(spy.project.draft.overrides.cement_bag).toBe(5);
    await click(q('pad-reset'));
    expect(spy.project.draft.overrides.cement_bag).toBeUndefined();
    await click(q('pad-done'));
    await flushUserPrices();
    expect(currentBook('CL')?.user?.materials?.cement_bag).toBeUndefined();
  });

  it('works with no network at all: the base catalog prices the quote and the origin says so', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await mount({ initial: mk() });
      expect(q('ws-offline')).not.toBeNull();
      expect(q('price-cement_bag').getAttribute('data-origin')).toBe('base');
      expect(q('ws-total').textContent).toMatch(/\d/);
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });
});

describe('frozen quote', () => {
  const lockedProject = () => {
    const p = mk();
    return { ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) };
  };

  it('shows 🔒, a tap on a price answers "Precios bloqueados" with a toast and opens no pad', async () => {
    const spy = {};
    await mount({ initial: lockedProject(), spy });
    expect(q('ws-lock-chip').textContent).toContain('🔒');
    expect(q('price-cement_bag').getAttribute('data-locked')).toBe('true');
    await click(q('price-cement_bag'));
    expect(q('price-numpad')).toBeNull();
    expect(q('toast').textContent).toBe('Precios bloqueados');
    expect(spy.project.draft.overrides).toEqual({});
  });

  it('the unlock button warns first; confirming releases the prices and the pad works again', async () => {
    const spy = {};
    await mount({ initial: lockedProject(), spy });
    await click(q('ws-unlock'));
    expect(q('unlock-warning').textContent).toMatch(/firma/);
    expect(spy.project.draft.frozen).not.toBeNull(); // nothing changed yet
    await click(q('unlock-confirm'));
    expect(spy.project.draft.frozen).toBeNull();
    expect(q('ws-lock-chip')).toBeNull();
    await click(q('price-cement_bag'));
    expect(q('price-numpad')).not.toBeNull();
  });
});

describe('no way out to the old editor + queue list', () => {
  it('there is no "Editor avanzado": crew, machinery, finance and expenses all live in the screen', async () => {
    await mount({ initial: mk() });
    expect(q('ws-advanced')).toBeNull();
    expect(['ws-crew', 'ws-machinery', 'ws-finance', 'ws-expenses'].map((k) => !!q(k))).toEqual([true, true, true, true]);
  });

  it('receipts waiting for a connection are listed with their state, badge on the dock, and can be discarded / retried', async () => {
    const p = mk();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const rows = [{ id: 'abcd1', projectId: p.id, status: 'pending', createdAt: Date.now(), blob }, { id: 'abcd2', projectId: p.id, status: 'failed', createdAt: Date.now(), blob }, { id: 'zzzz9', projectId: 'otroproyecto1', status: 'pending', createdAt: Date.now(), blob }];
    const receipts = { rows, retry: vi.fn(), discard: vi.fn(), accept: vi.fn() };
    await mount({ initial: p, receipts });
    expect(q('dock-queued').textContent).toBe('1'); // only this project's pending one
    await click(q('ws-expenses').querySelector('summary'));
    expect(qa('queue-list')).toHaveLength(1);
    expect(q('queued-abcd1').textContent).toContain('Pendiente de conexión');
    expect(q('queued-abcd2').textContent).toContain('No se pudo leer');
    expect(q('queued-zzzz9')).toBeNull();
    await click(q('queued-discard-abcd1'));
    expect(receipts.discard).toHaveBeenCalledWith('abcd1');
    await click(q('queued-retry-abcd2'));
    expect(receipts.retry).toHaveBeenCalledWith('abcd2');
  });
});

describe('Escáner IA offline: the photo is parked, never read locally', () => {
  const prepare = async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 1, height: 1 });
  const pick = async () => {
    const input = q('receipt-camera-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(10);
  };
  const sheet = (props) => act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ReceiptSheet, { onSave: () => {}, onClose: () => {}, prepareImage: prepare, ...props }))));

  it('no connection: the compressed image goes to onQueue, the proxy is NOT called, the user sees "Pendiente de conexión"', async () => {
    const onQueue = vi.fn(async () => {});
    const fetchImpl = vi.fn();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await sheet({ onQueue, fetchImpl });
      await pick();
      expect(onQueue).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(q('receipt-queued').textContent).toMatch(/pendiente de conexión/i);
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });

  it('the line dies while reading: the photo is parked instead of failing', async () => {
    const onQueue = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await sheet({ onQueue, fetchImpl });
    await pick();
    expect(fetchImpl).toHaveBeenCalled();
    expect(onQueue).toHaveBeenCalledTimes(1);
    expect(q('receipt-queued')).not.toBeNull();
  });

  it('without onQueue (old screens) the behaviour is unchanged: a network error is shown as an error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await sheet({ fetchImpl });
    await pick();
    expect(q('receipt-error').getAttribute('data-code')).toBe('network');
    expect(new InvoiceError('network').code).toBe('network');
  });

  it('a full queue is reported to the user', async () => {
    const onQueue = vi.fn(async () => {
      throw new Error('queue_full');
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await sheet({ onQueue });
      await pick();
      expect(q('receipt-error').getAttribute('data-code')).toBe('queue_full');
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });
});
