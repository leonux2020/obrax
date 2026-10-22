// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';

// The renderers are replaced by spies: this suite is about WHICH document is requested and how it is delivered.
const spies = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn(), share: vi.fn() }));
vi.mock('../src/lib/reportPdf.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    warmPdfEngine: () => Promise.resolve(),
    createReportPdf: (...a) => spies.create(...a),
    pdfToFile: (doc, fileName) => ({ name: fileName, type: 'application/pdf', doc }),
    sharePdfFile: (...a) => spies.share(...a),
  };
});
vi.mock('../src/lib/pdf.js', async (orig) => ({ ...(await orig()), savePdf: (...a) => spies.save(...a) }));

import StepReport from '../src/components/steps/StepReport.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { canShareFile, kindForView } from '../src/lib/reportPdf.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = 1_700_000_000_000;
const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

const draft = newDraft('CL');
draft.partidas[0].dims = { ...draft.partidas[0].dims, length: 6, width: 4 };
const result = computeAll(draft, NOW);
const company = { name: 'Obra SA', taxId: '', phone: '', email: '', city: '', logo: '' };

let host;
let root;
beforeEach(() => {
  spies.create.mockReset().mockImplementation(async (kind) => ({ doc: { kind }, fileName: `${kind}.pdf`, title: 'Reporte de Obra', kind }));
  spies.save.mockReset();
  spies.share.mockReset().mockResolvedValue('shared');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      React.createElement(
        I18nProvider,
        { lang: 'es', regionCode: 'CL' },
        React.createElement(StepReport, { draft, setDraft: () => {}, result, pricedAt: NOW, photos: [], company, onNewProject: () => {} })
      )
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const tab = (name) => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('contextual PDF button', () => {
  it('there is ONE download button and ONE share button, no per-document buttons', () => {
    expect(host.querySelectorAll('[data-testid="pdf-download"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-testid="pdf-share"]')).toHaveLength(1);
    expect(q('pdf-download').textContent).toContain(DICT.es['pdf.download']);
    expect(host.textContent).not.toContain(DICT.es['pdf.client']);
    expect(host.textContent).not.toContain(DICT.es['pdf.tech']);
  });

  it('downloads exactly the document of the open tab, whichever tab that is', async () => {
    await click(q('pdf-download'));
    await flush();
    expect(spies.create.mock.calls.map((c) => c[0])).toEqual(['client']);
    expect(spies.save).toHaveBeenCalledTimes(1);
    expect(spies.save.mock.calls[0][1]).toBe('client.pdf');

    await click(tab('Vista técnica'));
    expect(q('pdf-hint').textContent).toBe(DICT.es['pdf.techHint']);
    await click(q('pdf-download'));
    await flush();
    expect(spies.create.mock.calls.map((c) => c[0])).toEqual(['client', 'tech']);
    expect(spies.save.mock.calls[1][1]).toBe('tech.pdf');

    await click(tab('Vista comercial'));
    expect(q('pdf-hint').textContent).toBe(DICT.es['pdf.clientHint']);
    await click(q('pdf-download'));
    await flush();
    expect(spies.create.mock.calls.map((c) => c[0])).toEqual(['client', 'tech', 'client']);
  });

  it('switching tab while a PDF is being generated cannot change which document it is', async () => {
    let release;
    spies.create.mockImplementationOnce((kind) => new Promise((r) => { release = () => r({ doc: { kind }, fileName: `${kind}.pdf`, title: 't', kind }); }));
    await click(q('pdf-download')); // client tab is open
    expect(q('pdf-download').disabled).toBe(true);
    expect(q('pdf-share').disabled).toBe(true); // one job at a time
    await click(tab('Vista técnica'));
    await act(async () => release());
    await flush();
    expect(spies.create.mock.calls.map((c) => c[0])).toEqual(['client']);
    expect(spies.save.mock.calls[0][1]).toBe('client.pdf');
    expect(q('pdf-download').disabled).toBe(false); // lock released
  });

  it('a double tap generates only one PDF', async () => {
    await act(async () => {
      q('pdf-download').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      q('pdf-download').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.save).toHaveBeenCalledTimes(1);
  });

  it('a failing generation shows the error and unlocks the buttons', async () => {
    spies.create.mockRejectedValueOnce(new Error('boom'));
    await click(q('pdf-download'));
    await flush();
    expect(host.querySelector('[role="alert"]').textContent).toBe(DICT.es['pdf.error']);
    expect(q('pdf-download').disabled).toBe(false);
    await click(q('pdf-download'));
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(spies.save).toHaveBeenCalledTimes(1);
  });
});

describe('native share of the PDF file', () => {
  it('shares the file of the open tab with the localized title, without downloading', async () => {
    await click(tab('Vista técnica'));
    await click(q('pdf-share'));
    await flush();
    expect(spies.create.mock.calls.map((c) => c[0])).toEqual(['tech']);
    const [file, meta] = spies.share.mock.calls[0];
    expect(file).toMatchObject({ name: 'tech.pdf', type: 'application/pdf' });
    expect(meta.title).toBe('Reporte de Obra');
    expect(spies.save).not.toHaveBeenCalled();
  });

  it('falls back to a download when the device cannot share files; a cancelled share is silent', async () => {
    spies.share.mockResolvedValueOnce('unsupported');
    await click(q('pdf-share'));
    await flush();
    expect(spies.save).toHaveBeenCalledTimes(1);
    spies.share.mockResolvedValueOnce('cancelled');
    await click(q('pdf-share'));
    await flush();
    expect(spies.save).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('sharePdfFile talks to navigator.share({ files, title }) and classifies the outcomes', async () => {
    const { sharePdfFile: realShare } = await vi.importActual('../src/lib/reportPdf.js');
    const file = { name: 'x.pdf' };
    const nav = (share, canShare) => ({ share, canShare });
    const ok = vi.fn().mockResolvedValue(undefined);
    expect(await realShare(file, { title: 'Reporte de Obra' }, nav(ok, () => true))).toBe('shared');
    expect(ok).toHaveBeenCalledWith({ files: [file], title: 'Reporte de Obra' });
    // share() exists but refuses files: the NATIVE sheet still opens, with title + text (no forced download)
    const text = vi.fn().mockResolvedValue(undefined);
    expect(await realShare(file, { title: 't', text: 'resumen' }, nav(text, () => false))).toBe('shared-text');
    expect(text).toHaveBeenCalledWith({ title: 't', text: 'resumen' });
    expect(await realShare(file, { title: 't' }, nav(text, () => false))).toBe('shared-text');
    expect(text).toHaveBeenLastCalledWith({ title: 't' });
    // no navigator.share at all: the caller downloads
    expect(await realShare(file, { title: 't' }, null)).toBe('unsupported');
    expect(await realShare(file, { title: 't' }, {})).toBe('unsupported');
    // files refused at the last moment (NotSupportedError): falls through to the text-only native sheet
    const refuse = vi.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotSupportedError' })).mockResolvedValueOnce(undefined);
    expect(await realShare(file, { title: 't', text: 'r' }, nav(refuse, () => true))).toBe('shared-text');
    expect(refuse).toHaveBeenNthCalledWith(1, { files: [file], title: 't' });
    expect(refuse).toHaveBeenNthCalledWith(2, { title: 't', text: 'r' });
    expect(await realShare(file, { title: 't' }, { share: ok })).toBe('shared'); // canShare is optional
    const fail = (name) => vi.fn().mockRejectedValue(Object.assign(new Error(name), { name }));
    expect(await realShare(file, { title: 't' }, nav(fail('AbortError'), () => true))).toBe('cancelled');
    expect(await realShare(file, { title: 't' }, nav(fail('NotAllowedError'), () => true))).toBe('unsupported');
    await expect(realShare(file, { title: 't' }, nav(fail('QuotaExceededError'), () => true))).rejects.toThrow(); // unknown failures still surface
    expect(canShareFile(file, { share: ok })).toBe(true);
    expect(canShareFile(file, {})).toBe(false);
  });

  it('kindForView maps tabs to documents and the share title exists in six languages', () => {
    expect(kindForView('client')).toBe('client');
    expect(kindForView('tech')).toBe('tech');
    expect(kindForView('anything')).toBe('client');
    expect(DICT.es['report.shareTitle']).toBe('Reporte de Obra');
    for (const l of LANGS) {
      expect(DICT[l]['report.shareTitle']).toBeTruthy();
      expect(DICT[l]['pdf.download']).toBeTruthy();
    }
  });
});

describe('real PDF generation per kind (no spies)', () => {
  it('client and tech documents are different, independent and repeatable in any order', async () => {
    const real = await vi.importActual('../src/lib/reportPdf.js');
    const { makeI18n } = await import('../src/lib/i18n.jsx');
    const i18n = makeI18n('es', 'CL');
    const inputs = { draft, result, company, i18n, photos: [] };
    const text = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
    const a = await real.createReportPdf('tech', inputs);
    const b = await real.createReportPdf('client', inputs);
    const c = await real.createReportPdf('tech', inputs);
    expect(a.fileName).toContain(DICT.es['pdf.file.tech']);
    expect(b.fileName).toContain(DICT.es['pdf.file.client']);
    expect(text(a.doc)).toContain('Reporte');
    expect(text(b.doc)).not.toBe(text(a.doc));
    expect(text(c.doc).length).toBe(text(a.doc).length); // no state leaked from the client run
    expect(b.title).toBe('Reporte de Obra');
    const file = real.pdfToFile(b.doc, b.fileName);
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBeGreaterThan(500);
    await expect(real.createReportPdf('nope', inputs)).rejects.toThrow();
  });
});

describe('visual contract of the actions', () => {
  it('OLED: thin white/10 borders on the tabs and ghost buttons, no grey backgrounds', () => {
    const rep = read('components/steps/StepReport.jsx');
    expect(rep).toContain("'border-white/10 hover:border-white/30'");
    expect(read('components/ui.jsx')).toContain("ghost: 'border border-white/10");
    expect(rep).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
    expect(rep).not.toContain("download('client')");
  });
});
