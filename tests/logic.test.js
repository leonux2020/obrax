import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  sanitizeNumericText,
  parseDecimal,
  coerceNumber,
  sanitizeText,
  sanitizeEmail,
  sanitizeAvatarUrl,
} from '../src/lib/sanitize.js';
import { calcSlab, calcMasonry, calcDrywall } from '../src/lib/calc.js';
import { validateDims } from '../src/lib/tasks.js';
import { resolvePrices, buildQuote, referencePrice, applyWaste } from '../src/lib/pricing.js';
import { REGIONS } from '../src/lib/regions.js';
import { normalizeDraft, normalizeUser, newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { createRateLimiter } from '../src/lib/shield.js';
import { buildManifest, buildIconSvg } from '../src/brand/icon.js';
import { CSP_HEADER } from '../security/policy.js';
import { DICT } from '../src/lib/dict.js';
import { CATALOG } from '../src/lib/catalog.js';

describe('sanitization', () => {
  it('keeps only digits and one decimal mark', () => {
    expect(sanitizeNumericText('12,5abc')).toBe('12.5');
    expect(sanitizeNumericText('1.2.3')).toBe('1.23');
    expect(sanitizeNumericText('<script>alert(1)</script>')).toBe('1');
    expect(sanitizeNumericText('-5; DROP TABLE')).toBe('5');
    expect(sanitizeNumericText('１２３')).toBe('123'); // full-width digits
    expect(sanitizeNumericText('1.239', 2)).toBe('1.23');
    expect(sanitizeNumericText('9'.repeat(40)).length).toBeLessThanOrEqual(12);
  });
  it('parses safely', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('3.5')).toBe(3.5);
  });
  it('coerces with range', () => {
    expect(coerceNumber('5', { min: 1, max: 10 })).toBe(5);
    expect(coerceNumber(500, { min: 1, max: 10 })).toBeNull();
    expect(coerceNumber(NaN)).toBeNull();
    expect(coerceNumber(Infinity)).toBeNull();
    expect(coerceNumber({ a: 1 })).toBeNull();
    expect(coerceNumber('1e9')).toBe(19); // "1e9" -> digits only => "19"
  });
  it('strips markup from text', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)> Casa')).not.toMatch(/[<>]/);
    expect(sanitizeText('a\u0000b\n\tc')).toBe('a b c');
    expect(sanitizeText('x'.repeat(500), 80).length).toBe(80);
  });
  it('validates email and avatar', () => {
    expect(sanitizeEmail('Foo@Bar.com')).toBe('foo@bar.com');
    expect(sanitizeEmail('nope')).toBe('');
    expect(sanitizeAvatarUrl('https://lh3.googleusercontent.com/a/x')).toMatch(/^https:/);
    expect(sanitizeAvatarUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeAvatarUrl('https://evil.com/x.png')).toBe('');
    expect(sanitizeAvatarUrl('https://googleusercontent.com.evil.com/x')).toBe('');
  });
});

describe('calculations', () => {
  it('slab: 5 x 4 m, 10 cm = 2 m3 of concrete', () => {
    const r = calcSlab({ length: 5, width: 4, thickness: 10 });
    expect(r.metrics.find((m) => m.key === 'volume').value).toBe(2);
    expect(r.lines.find((l) => l.id === 'cement_bag').qty).toBeCloseTo(24);
    expect(r.lines.find((l) => l.id === 'mesh').qty).toBeCloseTo(22);
  });
  it('masonry: picks block by thickness and deducts openings', () => {
    const r = calcMasonry({ length: 10, height: 2.5, thickness: 14, openings: 5 });
    expect(r.metrics.find((m) => m.key === 'netArea').value).toBe(20);
    expect(r.lines[0].id).toBe('block_14');
    expect(r.lines[0].qty).toBeCloseTo(250);
    expect(calcMasonry({ length: 1, height: 1, thickness: 19 }).lines[0].id).toBe('block_19');
  });
  it('drywall: two faces double the board area', () => {
    const one = calcDrywall({ length: 6, height: 2.4, thickness: 12.5, faces: 1 });
    const two = calcDrywall({ length: 6, height: 2.4, thickness: 12.5, faces: 2 });
    expect(two.lines[0].qty).toBeCloseTo(one.lines[0].qty * 2);
    expect(calcDrywall({ length: 1, height: 1, thickness: 15 }).lines[0].id).toBe('plate_15');
  });
});

describe('validation', () => {
  it('flags required and out-of-range values', () => {
    const v = validateDims('slab', { length: null, width: 0, thickness: 10 });
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBe('required');
    expect(v.errors.width).toBe('range');
  });
  it('rejects openings larger than the wall', () => {
    const v = validateDims('masonry', { length: 2, height: 2, thickness: 14, openings: 10 });
    expect(v.errors.openings).toBe('openings');
  });
  it('accepts a valid slab', () => {
    expect(validateDims('slab', { length: 5, width: 4, thickness: 10 }).valid).toBe(true);
  });
});

describe('pricing & quote', () => {
  it('is deterministic and positive in every region', () => {
    for (const r of Object.values(REGIONS)) {
      for (const id of Object.keys(CATALOG)) {
        const a = referencePrice(id, r, r.chains[0], 123);
        expect(a).toBe(referencePrice(id, r, r.chains[0], 123));
        expect(a).toBeGreaterThan(0);
      }
    }
  });
  it('best mode is never more expensive than any single chain', () => {
    const ids = Object.keys(CATALOG);
    const best = resolvePrices({ ids, regionCode: 'ES', chainId: 'best', bucket: 5 });
    for (const c of REGIONS.ES.chains) {
      const one = resolvePrices({ ids, regionCode: 'ES', chainId: c.id, bucket: 5 });
      for (const id of ids) expect(best[id].price).toBeLessThanOrEqual(one[id].price);
    }
  });
  it('manual overrides win and invalid ones are ignored', () => {
    const p = resolvePrices({ ids: ['sand'], regionCode: 'CL', chainId: 'sodimac', overrides: { sand: 12345 }, bucket: 1 });
    expect(p.sand.price).toBe(12345);
    expect(p.sand.source).toBe('manual');
    const bad = resolvePrices({ ids: ['sand'], regionCode: 'CL', chainId: 'sodimac', overrides: { sand: -5 }, bucket: 1 });
    expect(bad.sand.source).toBe('ref');
  });
  it('waste rounds discrete items up', () => {
    expect(applyWaste(10, 5, true)).toBe(11);
    expect(applyWaste(10, 0, true)).toBe(10);
    expect(applyWaste(1, 10, false)).toBe(1.1);
  });
  it('quote adds labor, transport and tax', () => {
    const lines = calcSlab({ length: 5, width: 4, thickness: 10 }).lines;
    const prices = resolvePrices({ ids: lines.map((l) => l.id), regionCode: 'CL', chainId: 'best', bucket: 1 });
    const q = buildQuote({ lines, prices, finance: { waste: 5, labor: 40, transport: 10 }, regionCode: 'CL' });
    expect(q.labor).toBe(Math.round(q.materials * 0.4));
    expect(q.transport).toBe(Math.round(q.materials * 0.1));
    expect(q.total).toBe(q.subtotal + q.tax);
  });
  it('engine end to end', () => {
    const d = newDraft('MX');
    d.dims = { ...d.dims, length: 6, width: 3 };
    const r = computeAll(d, 1_700_000_000_000);
    expect(r.valid).toBe(true);
    expect(r.quote.total).toBeGreaterThan(0);
    expect(computeAll(newDraft('MX')).valid).toBe(false);
  });
});

describe('persistence hardening', () => {
  it('rebuilds a safe draft from hostile storage content', () => {
    const evil = {
      regionCode: 'CL',
      task: '__proto__',
      step: 99,
      dims: { length: '<script>', width: 1e12, thickness: -4 },
      finance: { labor: 9999, transport: 'x', waste: null },
      chainId: '../../etc',
      overrides: { sand: 'DROP', gravel: -1, __proto__: { x: 1 } },
      project: { name: '<b>hi</b>', client: 'x'.repeat(999) },
    };
    const d = normalizeDraft(evil, 'CL');
    expect(d.task).toBe('slab');
    expect(d.step).toBe(4);
    expect(d.dims.width).toBeNull();
    expect(d.finance.labor).toBe(35);
    expect(d.chainId).toBe('best');
    expect(d.overrides).toEqual({});
    expect(d.project.name).not.toMatch(/[<>]/);
    expect(d.project.client.length).toBe(80);
  });
  it('discards a draft from another region', () => {
    expect(normalizeDraft({ regionCode: 'ES', task: 'masonry' }, 'CL').task).toBe('slab');
  });
  it('normalizes users', () => {
    expect(normalizeUser({ provider: 'admin' })).toBeNull();
    expect(normalizeUser({ provider: 'google', name: '<x>', picture: 'http://x' }).picture).toBe('');
  });
});

describe('shield', () => {
  it('rate limiter blocks bursts', () => {
    let t = 0;
    const lim = createRateLimiter(3, 1000, () => t);
    expect([lim(), lim(), lim(), lim()]).toEqual([true, true, true, false]);
    t = 1500;
    expect(lim()).toBe(true);
  });
});

describe('branding / PWA / security config', () => {
  it('manifest references 192 + 512 icons and the SVG', () => {
    const m = buildManifest();
    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i) => i.type === 'image/svg+xml')).toBe(true);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(m.background_color).toBe('#000000');
  });
  it('icon svg is valid-looking and OLED black', () => {
    const svg = buildIconSvg();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill="#000000"');
  });
  it('vercel.json CSP mirrors the policy', () => {
    const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const csp = v.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
    expect(csp).toBe(CSP_HEADER);
  });
  it('every i18n key exists in both languages', () => {
    expect(Object.keys(DICT.en).sort()).toEqual(Object.keys(DICT.es).sort());
  });
  it('every catalog item has a translated name in both languages', () => {
    for (const id of Object.keys(CATALOG)) {
      expect(DICT.es[`mat.${id}`]).toBeTruthy();
      expect(DICT.en[`mat.${id}`]).toBeTruthy();
    }
  });
});
