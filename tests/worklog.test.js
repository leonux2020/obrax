// @vitest-environment happy-dom
// The Bitácora accordion of the living list (Zone B): notes readable on site, edit / delete, and the dock's 🎙️ opens it by itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { resetBoot } from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject } from '../src/lib/projects.js';
import { editNote } from '../src/components/workspace/LogBlock.jsx';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(10);
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pop = async () => {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await flush(10);
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  window.history.replaceState(null, '');
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

// ---- the real App --------------------------------------------------------------------------------------------------------------
async function mountApp() {
  resetBoot();
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
  });
}
const seed = async (projects = []) => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
  for (const p of projects) await projectStore.save(p);
};

const typeIntoArea = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const active = (extra = {}) => ({
  ...newProject({ regionCode: 'CL', name: 'Casa Soto', client: 'Luis Soto', startDate: '2026-03-02' }),
  logbook: [
    { id: 'log001', at: at(2026, 3, 3), text: 'Comprar clavos' },
    { id: 'log002', at: at(2026, 3, 8), text: 'Traer la comida al perro.' },
  ],
  ...extra,
});

class FakeRecognition {
  static all = [];
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {}
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
  say(text) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  }
}

const open = async (project) => {
  await seed([project]);
  await mountApp();
  await click(q('project-card'));
};
const saved = async () => {
  await flush(400); // the open project saves itself ~250 ms after a change
  return (await projectStore.load())[0];
};

describe('Bitácora de obra accordion (Zone B)', () => {
  it('editNote: replaces the text of ONE note, keeps its id and date, ignores an empty text', () => {
    const list = active().logbook;
    const next = editNote(list, 'log001', '  Comprar clavos de 2 pulgadas ');
    expect(next[0]).toEqual({ id: 'log001', at: list[0].at, text: 'Comprar clavos de 2 pulgadas' });
    expect(next[1]).toBe(list[1]);
    expect(editNote(list, 'log001', '   ')).toBe(list);
  });

  it('lists the notes of the running project, newest first, closed until opened; counts them', async () => {
    await open(active());
    const block = q('ws-log');
    expect(block).not.toBeNull();
    expect(block.tagName).toBe('DETAILS');
    expect(block.open).toBe(false);
    expect(block.textContent).toContain('Bitácora de obra');
    await click(block.querySelector('summary'));
    expect(block.open).toBe(true);
    const notes = qa('wlog-note');
    expect(notes.map((n) => n.querySelector('[data-testid="wlog-text"]').textContent)).toEqual(['Traer la comida al perro.', 'Comprar clavos']);
    expect(block.querySelector('summary').textContent).toContain('2');
    // it sits in Zone B, before the expenses, and the dock is still the way to dictate
    expect(q('ws-zone-c')).not.toBeNull();
    expect(q('dock-log')).not.toBeNull();
  });

  it('empty project: a hint that points at the dock microphone', async () => {
    await open(active({ logbook: [] }));
    await click(q('ws-log').querySelector('summary'));
    expect(q('wlog-empty').textContent).toContain('🎙️');
  });

  it('edit: a plain textarea in place; saving persists the corrected text (IndexedDB); cancel changes nothing', async () => {
    await open(active());
    await click(q('ws-log').querySelector('summary'));
    await click(q('wlog-edit-log001'));
    const input = q('wlog-input');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.value).toBe('Comprar clavos');
    await typeIntoArea(input, 'Comprar clavos de 3 pulgadas');
    await click(q('wlog-cancel'));
    expect(q('wlog-input')).toBeNull();
    expect(q('ws-log').textContent).toContain('Comprar clavos');
    expect(q('ws-log').textContent).not.toContain('3 pulgadas');
    await click(q('wlog-edit-log001'));
    await typeIntoArea(q('wlog-input'), 'Comprar clavos de 3 pulgadas');
    await click(q('wlog-save'));
    expect(q('wlog-input')).toBeNull();
    expect(q('ws-log').textContent).toContain('Comprar clavos de 3 pulgadas');
    const stored = await saved();
    expect(stored.logbook.map((e) => e.text)).toEqual(['Comprar clavos de 3 pulgadas', 'Traer la comida al perro.']);
    expect(stored.logbook.find((e) => e.id === 'log001')).toMatchObject({ at: at(2026, 3, 3), text: 'Comprar clavos de 3 pulgadas' });
    expect(stored.logbook).toHaveLength(2);
  });

  it('delete: asks first; confirmed it leaves the list and the stored project; declined it stays', async () => {
    await open(active());
    await click(q('ws-log').querySelector('summary'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await click(q('wlog-del-log002'));
    expect(qa('wlog-note')).toHaveLength(2);
    await click(q('wlog-del-log002'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(qa('wlog-note')).toHaveLength(1);
    const stored = await saved();
    expect(stored.logbook.map((e) => e.id)).toEqual(['log001']);
  });

  it('the dock 🎙️ dictates; the new note is saved, the sheet closes and the accordion OPENS by itself with the note in it', async () => {
    window.webkitSpeechRecognition = FakeRecognition;
    FakeRecognition.all = [];
    await open(active());
    expect(q('ws-log').open).toBe(false);
    await click(q('dock-log'));
    expect(q('log-input')).not.toBeNull();
    expect(q('log-list')).toBeNull(); // the notes are not repeated inside the sheet: they live in the accordion
    await click(q('log-mic'));
    await act(async () => FakeRecognition.all.at(-1).say('pedir cemento para mañana'));
    await click(q('log-mic')); // stop -> end of the dictation -> saved
    await flush(20);
    expect(q('log-input')).toBeNull(); // sheet closed
    expect(q('ws-log').open).toBe(true);
    const first = qa('wlog-note')[0];
    expect(first.querySelector('[data-testid="wlog-text"]').textContent).toBe('pedir cemento para mañana.');
    expect(qa('wlog-note')).toHaveLength(3);
    const stored = await saved();
    expect(stored.logbook[0].text).toBe('pedir cemento para mañana.');
    delete window.webkitSpeechRecognition;
  });

  it('the accordion opens and closes by hand (nothing re-opens it)', async () => {
    await open(active());
    const block = q('ws-log');
    await click(block.querySelector('summary'));
    await click(block.querySelector('summary'));
    expect(block.open).toBe(false);
  });

  it('the texts exist in the six languages', async () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      for (const key of ['ws.log.title', 'ws.log.empty', 'ws.log.edit', 'ws.log.save', 'ws.log.confirmDelete']) {
        expect(DICT[lang][key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});
