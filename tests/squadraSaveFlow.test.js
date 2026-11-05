// @vitest-environment happy-dom
// Organic save flow of the worker file: saving an EXISTING worker keeps the sheet open and flips edit -> read (the card shows what was stored,
// nothing closes); saving a NEW worker closes the sheet as always.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import SquadraSheet from '../src/components/squadra/SquadraSheet.jsx';
import WorkerSheet from '../src/components/squadra/WorkerSheet.jsx';
import { loadWorkers, saveWorkers } from '../src/lib/workers.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const submit = () => act(async () => q('worker-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const dialogs = () => document.querySelectorAll('[role="dialog"]').length;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('Squadra: saving an EXISTING worker', () => {
  const mountSquadra = async (onClose = () => {}) => {
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz', specialties: ['plumber'], rating: 3, phone: '111', email: 'ana@obra.cl', city: 'Maipú', address: 'Calle 1' }]);
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(SquadraSheet, { projects: [], onClose })));
    });
    await flush();
    await click(q('worker-wk000001'));
  };

  it('the sheet does NOT close: edit -> save -> the refreshed read-only card, same two dialogs still open', async () => {
    const onClose = vi.fn();
    await mountSquadra(onClose);
    const open = dialogs();
    expect(q('worker-card')).not.toBeNull();
    await click(q('worker-edit'));
    expect(q('worker-form')).not.toBeNull(); // isEditing = true
    await typeInto(q('worker-name'), 'Ana María Ruiz');
    await typeInto(q('worker-email'), 'nueva@obra.cl');
    await typeInto(q('worker-address'), 'Calle 99');
    await submit();
    // isEditing = false again, on the card, with what was just stored
    expect(q('worker-form')).toBeNull();
    expect(q('worker-card')).not.toBeNull();
    expect(dialogs()).toBe(open); // nothing was unmounted
    expect(onClose).not.toHaveBeenCalled();
    expect(q('worker-card-name').textContent).toBe('Ana María Ruiz');
    expect(q('worker-card-email').textContent).toBe('nueva@obra.cl');
    expect(q('worker-card-place').textContent).toBe('Calle 99, Maipú');
    expect(q('worker-edit')).not.toBeNull(); // the pencil is back
    // and it was really saved: once, in place
    const list = loadWorkers();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'wk000001', name: 'Ana María Ruiz', email: 'nueva@obra.cl', address: 'Calle 99' });
  });
  it('after saving, editing again starts from the SAVED data and cancel returns to the updated card (not the original one)', async () => {
    await mountSquadra();
    await click(q('worker-edit'));
    await typeInto(q('worker-name'), 'Ana B');
    await submit();
    await click(q('worker-edit'));
    expect(q('worker-name').value).toBe('Ana B');
    await typeInto(q('worker-name'), 'Descartado');
    await click(q('worker-cancel'));
    expect(q('worker-card-name').textContent).toBe('Ana B');
    expect(loadWorkers()[0].name).toBe('Ana B');
  });
  it('the cleaned file is what the card shows (the stored one: trimmed, normalized), not the raw form', async () => {
    await mountSquadra();
    await click(q('worker-edit'));
    await typeInto(q('worker-email'), '   spaced@obra.cl   ');
    await submit();
    expect(q('worker-card-email').textContent).toBe('spaced@obra.cl');
  });
  it('closing the card afterwards still works the native way (Escape closes only the worker sheet)', async () => {
    await mountSquadra();
    const before = dialogs();
    await click(q('worker-edit'));
    await submit();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(q('worker-card')).toBeNull();
    expect(dialogs()).toBe(before - 1);
  });
});

describe('Squadra: saving a NEW worker', () => {
  it('closes the worker sheet as before and the person is in the list', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(SquadraSheet, { projects: [], onClose })));
    });
    await flush();
    await click(q('squadra-new'));
    const withSheet = dialogs();
    await typeInto(q('worker-name'), 'Nuevo Maestro');
    await submit();
    expect(q('worker-form')).toBeNull();
    expect(q('worker-card')).toBeNull(); // not shown as a card: the sheet is gone
    expect(dialogs()).toBe(withSheet - 1);
    expect(onClose).not.toHaveBeenCalled(); // only the worker sheet closed, the directory stays
    const [w] = loadWorkers();
    expect(w.name).toBe('Nuevo Maestro');
    expect(q(`worker-${w.id}`)).not.toBeNull();
  });
});

describe('WorkerSheet on its own (the contract with its parent)', () => {
  const render = async (worker, onSave) => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(WorkerSheet, { worker, projects: [], onSave, onDelete: () => {}, onClose })));
    });
    await flush();
    return onClose;
  };
  it('existing: isEditing goes true -> false on save WITHOUT onClose; a parent that returns nothing still gets a refreshed card', async () => {
    const onSave = vi.fn(); // returns undefined: the sheet falls back to the normalized payload
    const onClose = await render({ id: 'wk000001', name: 'Ana', phone: '1' }, onSave);
    await click(q('worker-edit'));
    expect(q('worker-form')).not.toBeNull();
    await typeInto(q('worker-name'), 'Ana Nueva');
    await submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'wk000001', name: 'Ana Nueva' });
    expect(onClose).not.toHaveBeenCalled();
    expect(q('worker-form')).toBeNull();
    expect(q('worker-card-name').textContent).toBe('Ana Nueva');
  });
  it('existing: a parent that returns the stored file decides what the card shows', async () => {
    const onSave = vi.fn(() => ({ id: 'wk000001', name: 'Ana Guardada', phone: '1' }));
    await render({ id: 'wk000001', name: 'Ana', phone: '1' }, onSave);
    await click(q('worker-edit'));
    await submit();
    expect(q('worker-card-name').textContent).toBe('Ana Guardada');
  });
  it('new: the sheet itself stays in edit mode after onSave (closing is the parent\'s job: it unmounts the sheet)', async () => {
    const onSave = vi.fn();
    const onClose = await render(null, onSave);
    await typeInto(q('worker-name'), 'Nuevo');
    await submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(q('worker-card')).toBeNull(); // never flips to a card by itself
    expect(onClose).not.toHaveBeenCalled();
  });
  it('a name is still required: nothing is saved and an existing file stays in edit mode', async () => {
    const onSave = vi.fn();
    await render({ id: 'wk000001', name: 'Ana' }, onSave);
    await click(q('worker-edit'));
    await typeInto(q('worker-name'), '   ');
    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(q('worker-error')).not.toBeNull();
    expect(q('worker-form')).not.toBeNull();
  });
});
