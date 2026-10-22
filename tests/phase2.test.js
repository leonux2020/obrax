import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import {
  SIGNATURE_LIMITS,
  SignatureError,
  buildSignature,
  exportSignature,
  hasInk,
  isSignatureCurrent,
  normalizeSignature,
  pricingTime,
  strokeBounds,
} from '../src/lib/signature.js';
import { newDraft, normalizeDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel } from '../src/lib/reports.js';
import { renderClientPdf, pdfMoneyFormatter, pdfSafe } from '../src/lib/pdf.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';
import { newProject } from '../src/lib/projects.js';
import { createProjectStore, idbProjectBackend } from '../src/lib/projectStore.js';

// 1x1 valid PNG: stands in for an exported signature
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---- fake canvas that records what is drawn -------------------------------------------------------------
function fakeCanvasEnv(bytesPerPx = 0.5) {
  const canvases = [];
  const makeCanvas = () => {
    const log = { ops: [], strokeStyles: [], fills: 0, sizes: [] };
    const canvas = {
      _w: 300,
      _h: 150,
      log,
      get width() { return this._w; },
      set width(v) { this._w = v; },
      get height() { return this._h; },
      set height(v) { this._h = v; },
      getContext() {
        const ctx = {
          strokeStyle: '',
          fillStyle: '',
          lineWidth: 0,
          lineCap: '',
          lineJoin: '',
          clearRect() { log.ops.push('clear'); },
          fillRect() { log.fills += 1; },
          beginPath() {},
          moveTo() { log.ops.push('move'); },
          lineTo() { log.ops.push('line'); },
          quadraticCurveTo() { log.ops.push('quad'); },
          arc() { log.ops.push('arc'); },
          fill() { log.ops.push('fill'); },
          stroke() { log.strokeStyles.push(ctx.strokeStyle); log.ops.push('stroke'); },
        };
        return ctx;
      },
      toDataURL() {
        log.sizes.push([this._w, this._h]);
        const n = Math.ceil((this._w * this._h * bytesPerPx * 4) / 3 / 4) * 4;
        return `data:image/png;base64,${'A'.repeat(Math.max(4, n))}`;
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  return { makeCanvas, canvases };
}

const wave = (x0, y0, n = 40, dx = 6) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * dx, y: y0 + Math.sin(i / 3) * 18 }));

describe('signature export (finger / stylus strokes -> compressed base64 PNG)', () => {
  it('exports a cropped transparent PNG with black ink, within 480x220', () => {
    const { makeCanvas, canvases } = fakeCanvasEnv();
    const out = exportSignature([wave(50, 120), wave(60, 160, 20)], { makeCanvas });
    expect(out.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(out.w).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxWidth);
    expect(out.h).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxHeight);
    const c = canvases[0];
    expect(c.log.fills).toBe(0); // no background fill: stays transparent
    expect(c.log.strokeStyles.every((s) => s === '#000000')).toBe(true);
    expect(c.log.ops).toContain('quad'); // smooth curves, not straight segments
    expect(c.log.sizes[0]).toEqual([out.w, out.h]);
  });

  it('crops to the ink and keeps the aspect ratio', () => {
    const { makeCanvas } = fakeCanvasEnv();
    const strokes = [wave(200, 300, 30, 8)];
    const b = strokeBounds(strokes);
    const out = exportSignature(strokes, { makeCanvas });
    const cw = b.maxX - b.minX + 2 * SIGNATURE_LIMITS.padding;
    const ch = b.maxY - b.minY + 2 * SIGNATURE_LIMITS.padding;
    expect(Math.abs(out.w / out.h - cw / ch)).toBeLessThan(0.05);
  });

  it('a long signature is scaled down, a tiny one is enlarged at most 2x', () => {
    const { makeCanvas } = fakeCanvasEnv();
    const big = exportSignature([wave(0, 200, 120, 12)], { makeCanvas });
    expect(big.w).toBeLessThanOrEqual(480);
    const tiny = exportSignature([[{ x: 10, y: 10 }, { x: 20, y: 14 }]], { makeCanvas });
    expect(tiny.w).toBeLessThanOrEqual((10 + 12) * 2 + 1);
  });

  it('a single tap becomes a dot, an empty pad is refused', () => {
    const { makeCanvas, canvases } = fakeCanvasEnv();
    exportSignature([[{ x: 5, y: 5 }]], { makeCanvas });
    expect(canvases[0].log.ops).toContain('arc');
    expect(hasInk([])).toBe(false);
    expect(hasInk([[]])).toBe(false);
    expect(() => exportSignature([], { makeCanvas })).toThrow(SignatureError);
    expect(() => exportSignature([[]], { makeCanvas })).toThrow(/empty/);
  });

  it('shrinks step by step when a very busy scribble is still too heavy', () => {
    const { makeCanvas, canvases } = fakeCanvasEnv(2.5); // heavy bitmap
    const out = exportSignature([wave(0, 100, 200, 3)], { makeCanvas });
    expect(out.dataUrl.length).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxChars);
    expect(canvases.length).toBeGreaterThan(1);
    const hopeless = fakeCanvasEnv(500);
    expect(() => exportSignature([wave(0, 100, 50)], { makeCanvas: hopeless.makeCanvas })).toThrow(/store/);
  });
});

describe('stored signature is validated like any untrusted input', () => {
  const ink = { dataUrl: PNG, w: 120, h: 40 };

  it('keeps ink + client data + the total it was signed for', () => {
    const s = buildSignature({ ink, name: '  Ana   Ruiz <b>', taxId: '12.345.678-5', total: 1234.5, pricedAt: 1_700_000_000_000, now: 1_700_000_100_000 });
    expect(s).toEqual({ dataUrl: PNG, w: 120, h: 40, name: 'Ana Ruiz b', taxId: '12.345.678-5', at: 1_700_000_100_000, total: 1234.5, pricedAt: 1_700_000_000_000 });
  });

  it('rejects anything that is not a small base64 PNG', () => {
    for (const dataUrl of ['data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,AAAA', 'https://evil.example/s.png', 'data:image/png;base64,<script>', `data:image/png;base64,${'A'.repeat(70_000)}`, 42, null]) {
      expect(normalizeSignature({ ...ink, dataUrl })).toBeNull();
    }
    expect(normalizeSignature({ ...ink, w: 0 })).toBeNull();
    expect(normalizeSignature({ ...ink, h: 'x' })).toBeNull();
    expect(normalizeSignature(null)).toBeNull();
  });

  it('is stale as soon as the quote total changes', () => {
    const s = buildSignature({ ink, total: 100 });
    expect(isSignatureCurrent(s, 100)).toBe(true);
    expect(isSignatureCurrent(s, 100.001)).toBe(true);
    expect(isSignatureCurrent(s, 101)).toBe(false);
    expect(isSignatureCurrent(null, 100)).toBe(false);
  });
});

describe('a signed quote keeps the prices it was signed at', () => {
  const T0 = 1_700_000_000_000;
  const T1 = T0 + 6 * 3_600_000; // hours later: another market bucket

  it('live prices drift between price buckets, signed ones do not', () => {
    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const before = computeAll(d, T0).quote.total;
    expect(computeAll(d, T1).quote.total).not.toBe(before); // simulated market moved

    const signed = { ...d, signature: buildSignature({ ink: { dataUrl: PNG, w: 5, h: 5 }, total: before, pricedAt: T0 }) };
    expect(pricingTime(signed, T1)).toBe(T0);
    const reopened = computeAll(signed, pricingTime(signed, T1)).quote.total;
    expect(reopened).toBe(before);
    expect(isSignatureCurrent(signed.signature, reopened)).toBe(true);
    // removing the signature releases the prices again
    expect(pricingTime({ ...signed, signature: null }, T1)).toBe(T1);
  });
});

describe('project draft: signature + breakdown preference', () => {
  it('defaults: no signature, breakdown off', () => {
    const d = newDraft('CL');
    expect(d.showBreakdown).toBe(false);
    expect(d.signature).toBeNull();
  });

  it('normalizeDraft keeps valid values and drops junk', () => {
    const sig = buildSignature({ ink: { dataUrl: PNG, w: 10, h: 10 }, name: 'Luis', total: 5 });
    const ok = normalizeDraft({ ...newDraft('CL'), showBreakdown: true, signature: sig }, 'CL');
    expect(ok.showBreakdown).toBe(true);
    expect(ok.signature).toEqual(sig);
    const bad = normalizeDraft({ ...newDraft('CL'), showBreakdown: 'yes', signature: { dataUrl: 'javascript:alert(1)', w: 1, h: 1 } }, 'CL');
    expect(bad.showBreakdown).toBe(false);
    expect(bad.signature).toBeNull();
  });

  it('both are saved inside the project object in IndexedDB and survive a restart', async () => {
    const factory = new IDBFactory();
    const store = createProjectStore(idbProjectBackend(factory));
    const p = newProject({ regionCode: 'CL', name: 'Casa Roble', client: 'Ana', now: 1 });
    const signature = buildSignature({ ink: { dataUrl: PNG, w: 120, h: 40 }, name: 'Ana Ruiz', taxId: '11.111.111-1', total: 999 });
    await store.save({ ...p, draft: { ...p.draft, showBreakdown: true, signature } });

    const [back] = await createProjectStore(idbProjectBackend(factory)).load();
    expect(back.draft.showBreakdown).toBe(true);
    expect(back.draft.signature).toEqual(signature);
    expect(back.draft.signature.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('client report model and PDF', () => {
  const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const images = (s) => (s.match(/\/Subtype \/Image/g) || []).length;

  const setup = (patch = {}, lang = 'es') => {
    const d = { ...newDraft('CL'), ...patch };
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const result = computeAll(d, 1_700_000_000_000);
    const i = makeI18n(lang, 'CL');
    const base = { draft: d, result, company: { name: 'Obra SA', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
    return { d, result, i, base, money: pdfMoneyFormatter(i.region, i.locale) };
  };

  it('breakdown off by default: the client model carries no cost split', () => {
    const { base } = setup();
    const m = buildClientModel(base);
    expect(m.breakdown).toBeNull();
    expect(m.signature).toBeNull();
  });

  it('breakdown on: materials + labor + transport add up to the net subtotal and reveal no stores or unit prices', () => {
    const { base, result, i } = setup({ showBreakdown: true });
    const m = buildClientModel(base);
    // a 6x4 m slab (2.4 m3 of concrete) also gets the suggested concrete mixer rental
    expect(m.breakdown.rows.map((r) => r.label)).toEqual([i.t('bd.materials'), i.t('bd.labor'), i.t('bd.transport'), i.t('bd.machinery')]);
    expect(m.breakdown.rows.reduce((s, r) => s + r.amount, 0)).toBe(result.quote.subtotal);
    const json = JSON.stringify(m);
    for (const chain of ['Sodimac', 'Easy', 'Construmart']) expect(json).not.toContain(chain);
    expect(json).not.toMatch(/unitPrice/);
  });

  it('transport row is omitted when transport is 0 and the rows still add up', () => {
    const { base, result } = setup({ showBreakdown: true });
    const d = { ...base.draft, finance: { ...base.draft.finance, transport: 0 } };
    const r2 = computeAll(d, 1_700_000_000_000);
    const m = buildClientModel({ ...base, draft: d, result: r2 });
    expect(m.breakdown.rows).toHaveLength(3); // materials, labor, machinery
    expect(m.breakdown.rows.reduce((s, r) => s + r.amount, 0)).toBe(r2.quote.subtotal);
    expect(result.quote.transport).toBeGreaterThan(0);
  });

  it('a current signature is on the model; a stale one is left out', () => {
    const first = setup();
    const signature = buildSignature({ ink: { dataUrl: PNG, w: 120, h: 40 }, name: 'Ana Ruiz', taxId: '11.111.111-1', total: first.result.quote.total, now: new Date(2026, 9, 22, 12).getTime() });
    const signed = setup({ signature });
    const m = buildClientModel(signed.base);
    expect(m.signature).toMatchObject({ name: 'Ana Ruiz', idLine: 'ID: 11.111.111-1', w: 120, h: 40 });
    expect(m.signature.date).toContain('2026');

    const d = { ...signed.base.draft, finance: { ...signed.base.draft.finance, labor: 60 } };
    const changed = buildClientModel({ ...signed.base, draft: d, result: computeAll(d, 1_700_000_000_000) });
    expect(changed.signature).toBeNull();
  });

  it('PDF: breakdown rows and the signature (image + name + ID) appear only when enabled', async () => {
    const plain = setup();
    const off = raw(await renderClientPdf(buildClientModel(plain.base), { money: plain.money }));
    expect(images(off)).toBe(0);
    expect(off).not.toContain(pdfSafe(plain.i.t('bd.materials')));

    const signature = buildSignature({ ink: { dataUrl: PNG, w: 120, h: 40 }, name: 'Ana Ruiz', taxId: '11.111.111-1', total: plain.result.quote.total });
    const full = setup({ showBreakdown: true, signature });
    const on = raw(await renderClientPdf(buildClientModel(full.base), { money: full.money }));
    expect(images(on)).toBeGreaterThan(0); // the PNG (jsPDF adds a 2nd object for its alpha mask)
    for (const key of ['bd.title', 'bd.materials', 'bd.labor', 'bd.transport', 'bd.machinery']) expect(on).toContain(pdfSafe(full.i.t(key)));
    expect(on).toContain('Ana Ruiz');
    expect(on).toContain('11.111.111-1');
  });

  it('PDF with a stale signature does not print it', async () => {
    const s = setup();
    const signature = buildSignature({ ink: { dataUrl: PNG, w: 120, h: 40 }, name: 'Ana Ruiz', total: s.result.quote.total + 1000 });
    const stale = setup({ signature });
    const out = raw(await renderClientPdf(buildClientModel(stale.base), { money: stale.money }));
    expect(images(out)).toBe(0);
    expect(out).not.toContain('Ana Ruiz');
  });
});

describe('Phase 2 strings in six languages', () => {
  const KEYS = ['welcome.title', 'welcome.drive', 'welcome.skip', 'sign.title', 'sign.name', 'sign.id', 'sign.accept', 'bd.toggle', 'bd.title', 'bd.materials', 'bd.labor'];

  it('exist in every language', () => {
    for (const l of LANGS) for (const k of KEYS) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
  });

  it('Spanish uses the agreed wording and the universal "ID:" label', () => {
    expect(DICT.es['welcome.drive']).toBe('Proteger mis datos con Google Drive (Recomendado)');
    expect(DICT.es['welcome.skip']).toBe('Omitir por ahora');
    expect(DICT.es['sign.name']).toBe('Nombre del Cliente');
    expect(DICT.es['bd.toggle']).toBe('Mostrar desglose de Materiales y Mano de Obra en el PDF');
    for (const l of LANGS) expect(DICT[l]['sign.id']).toBe('ID:');
  });
});

describe('UI structure (OLED + one-hand ergonomics)', () => {
  const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

  it('signature is captured in a bottom sheet with a canvas, name and ID fields', () => {
    const sheet = read('components/SignatureSheet.jsx');
    expect(sheet).toContain('BottomSheet');
    expect(sheet).toContain('SignaturePad');
    expect(sheet).toContain("t('sign.name')");
    expect(sheet).toContain("t('sign.id')");
    const pad = read('components/SignaturePad.jsx');
    expect(pad).toMatch(/<canvas/);
    expect(pad).toContain('touch-none'); // no page scroll while signing
    expect(pad).toContain('onPointerDown');
    expect(pad).toContain('border-white/10');
  });

  it('the summary screen has the signature area and the breakdown switch before the PDF buttons', () => {
    const rep = read('components/steps/StepReport.jsx');
    const sig = rep.indexOf('<SignatureField');
    const toggle = rep.indexOf("t('bd.toggle')");
    const pdf = rep.indexOf("download('client')");
    expect(sig).toBeGreaterThan(0);
    expect(toggle).toBeGreaterThan(sig);
    expect(pdf).toBeGreaterThan(toggle);
  });

  it('welcome screen: highlighted primary + discreet text button, actions fixed to the bottom', () => {
    const w = read('components/WelcomeOnboarding.jsx');
    expect(w).toMatch(/fixed inset-x-0 bottom-0/);
    expect(w).toContain("variant=\"secondary\"");
    expect(w).toContain("t('welcome.drive')");
    expect(w).toContain("t('welcome.skip')");
    expect(w.indexOf("t('welcome.drive')")).toBeLessThan(w.indexOf("t('welcome.skip')"));
    expect(read('App.jsx')).toContain('WelcomeOnboarding');
  });

  it('switch is a real role="switch" with an ultra-thin border', () => {
    const ui = read('components/ui.jsx');
    expect(ui).toContain('role="switch"');
    expect(ui).toMatch(/aria-checked/);
  });
});
