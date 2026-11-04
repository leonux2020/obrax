// Phase 1 "Zero Stress" visual rules (decompression + ergonomics), kept as guards so they cannot creep back in:
//  1. no "grid effect": no 2 px bright outlines on buttons, solid primary CTAs, tinted secondary ones, softly filled fields
//  2. nothing smaller than text-xs (12 px) and no wide tracking on small text
//  3. one OLED text system: Tailwind neutral-* instead of hard-coded #E0E0E0 with arbitrary opacities
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../src', import.meta.url).pathname;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(jsx?|css)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const files = walk(root).filter((f) => !f.includes(`${path.sep}lib${path.sep}dict`)); // (the dictionaries hold prose, not classes)
const hits = (re) => files.flatMap((f) => (fs.readFileSync(f, 'utf8').match(re) || []).map((m) => `${path.relative(root, f)}: ${m}`));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('1. no grid effect: button hierarchy and soft fields', () => {
  it('no component uses a 2 px outline (border-2) any more', () => {
    expect(hits(/(?<![\w-])border-2(?![\w-])/g)).toEqual([]);
  });
  it('the primary button is a solid green fill with black lettering; the secondary is a faint fill with a hairline', () => {
    const ui = read('components/ui.jsx');
    expect(ui).toContain("primary: 'bg-brand text-black");
    expect(ui).toContain("secondary: 'border border-white/10 bg-white/5");
    expect(ui).toMatch(/danger: 'border border-red-500\/30 bg-red-500\/10/);
    expect(ui).not.toMatch(/(primary|secondary|ghost|danger): '[^']*border-brand/);
  });
  it('no button is an outlined-green CTA (border-brand + text-brand on the same element)', () => {
    expect(hits(/className="[^"]*(?<![:\w-])border-brand(?![\w/-])[^"]*text-brand[^"]*"/g)).toEqual([]);
  });
  it('fields are a subtle fill with a hairline; the green ring only appears on :focus', () => {
    const css = read('index.css');
    const rule = css.match(/\.field-input \{[\s\S]*?\}/)[0];
    expect(rule).toContain('bg-neutral-900');
    expect(rule).toContain('border border-white/10');
    expect(rule).not.toMatch(/border-2|border-neutral-700|(?<![:\w-])border-brand/);
    expect(rule).toContain('focus:border-brand');
    expect(rule).toContain('focus:ring-1 focus:ring-brand');
  });
});

describe('2. field legibility: 12 px floor, no wide tracking', () => {
  it('no text-[10px] / text-[11px] anywhere', () => {
    expect(hits(/text-\[1[01]px\]/g)).toEqual([]);
  });
  it('no tracking-wide / wider / widest (it slows the reading of small labels)', () => {
    expect(hits(/tracking-(wide|wider|widest)(?![\w-])/g)).toEqual([]);
  });
});

describe('3. one OLED grey system', () => {
  it('no hard-coded #E0E0E0 text (with or without opacity): neutral-200 is the main text, 400 / 500 the secondary ones', () => {
    expect(hits(/#e0e0e0/gi)).toEqual([]);
  });
  it('no neutral-600 text (below AA on pure black)', () => {
    expect(hits(/(?<![\w-])text-neutral-600(?![\w-])/g)).toEqual([]);
  });
});
