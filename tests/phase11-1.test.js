// Fase 11.1 "Zero Stress": PRO shimmer, donut colour hierarchy, Ajustes layout / type / naming, and the single lock element of a project.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DICT } from '../src/lib/dict.js';

const read = (f) => readFileSync(f, 'utf8');
const css = read('src/index.css');
const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de'];

describe('1. PRO logo shimmer: occasional, subtle, removable', () => {
  const rule = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  it('@keyframes shimmer ends with translateX(100%) and rests for most of the loop', () => {
    const k = css.slice(css.indexOf('@keyframes shimmer'), css.indexOf('.pro-shimmer {'));
    expect(k).toMatch(/100%\s*\{\s*transform: translateX\(100%\);/);
    expect(k).toMatch(/translateX\(-100%\)/);
    expect(k).toMatch(/93\.75%/);
  });
  it('lives on a ::after pseudo-element: diagonal translucent silver gradient, no pointer events, infinite, a long quiet loop', () => {
    const r = rule('.pro-shimmer::after');
    expect(r).toMatch(/linear-gradient\(115deg/);
    expect(r).toMatch(/rgba\(226, 232, 240, 0\.\d+\)/);
    expect(r).toContain('pointer-events: none');
    const m = r.match(/animation: shimmer (\d+)s infinite/);
    expect(m).not.toBeNull();
    const loop = Number(m[1]);
    expect(loop).toBeGreaterThanOrEqual(45);
    expect((3 / loop) * 100).toBeLessThan(10); // the glint is under 10 % of the time
    expect(rule('.pro-shimmer {')).toMatch(/overflow: hidden/);
  });
  it('reduced-motion and eco-mode already remove every animation, pseudo-elements included', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\*::after \{\s*animation: none !important/);
    expect(css).toMatch(/body\.eco-mode \*::after \{\s*animation: none !important/);
  });
  it('the PRO tag of the header carries it (also when PRO is active)', () => {
    const dash = read('src/components/Dashboard.jsx');
    expect(dash).toMatch(/className=\{`pro-shimmer flex items-center rounded-md border/);
  });
});

describe('2. Contabilidad donut: the green figure never competes with the ring', () => {
  const src = read('src/components/GlobalAccounting.jsx');
  const colors = [...src.match(/const SEGMENT_COLORS = \[(.*)\];/)[1].matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)].map((m) => m.slice(1).map(Number));
  it('the figure is emerald-400', () => {
    expect(src).toMatch(/liquid > 0 \? 'text-emerald-400'/);
  });
  it('segments are muted (reduced opacity), distinct from each other and never green-dominant', () => {
    expect(colors.length).toBeGreaterThanOrEqual(4);
    expect(new Set(colors.map((c) => c.join())).size).toBe(colors.length);
    for (const [r, g, b, a] of colors) {
      expect(a, 'muted').toBeLessThanOrEqual(0.6);
      expect(g > r && g > b, `green-dominant ${r},${g},${b}`).toBe(false);
    }
    expect(src.match(/const SEGMENT_COLORS = \[.*\];/)[0]).not.toMatch(/#[0-9a-f]{3,6}/i); // no hard-coded (green) hex left
  });
});

describe('3. Ajustes: naming, icon padding and light type', () => {
  const view = read('src/components/SettingsView.jsx');
  it('the workers section is "Elenco Lavoratori" (and the equivalent in the other five languages)', () => {
    expect(DICT.it['squadra.title']).toBe('Elenco Lavoratori');
    const titles = LANGS.map((l) => DICT[l]['squadra.title']);
    expect(new Set(titles).size).toBe(6);
    for (const t of titles) expect(t).not.toMatch(/\//); // no more "A / B" double names
  });
  it('the icon no longer touches the left border: the card keeps its horizontal padding (`!p-0` used to wipe px-4)', () => {
    const i = view.indexOf('data-testid="settings-squadra"');
    const btn = view.slice(i, view.indexOf('</button>', i));
    expect(btn).not.toMatch(/!p-0/);
    expect(btn).toMatch(/px-4 text-left/);
    expect(btn).toMatch(/gap-3/);
  });
  it('titles of the options: light, softly tracked, neutral-300 (Ajustes accordions + Squadra + Contabilidad cards)', () => {
    const light = /font-light tracking-\[0\.02em\] text-neutral-300/;
    expect(view.match(new RegExp(light.source, 'g'))).toHaveLength(3); // accordions, Squadra, the Drive switch
    expect(read('src/components/GlobalAccounting.jsx')).toMatch(light);
    expect(view).not.toMatch(/text-lg font-semibold/);
  });
});

describe('4. Project header: ONE element for the price lock', () => {
  const zone = read('src/components/workspace/HeaderZone.jsx');
  it('the loose yellow lock text is gone: the chip only exists in the read-only audit view, in neutral grey', () => {
    expect(zone).not.toMatch(/text-\[#e8c35f\]">\s*🔒/);
    const chip = zone.slice(zone.indexOf('data-testid="ws-lock-chip"') - 120, zone.indexOf('data-testid="ws-lock-chip"') + 200);
    expect(chip).toMatch(/model\.locked && audit/);
    expect(chip).toContain('text-neutral-400');
  });
  it('the unlock button carries the lock icon, the action and the reason; its label names both', () => {
    const i = zone.indexOf('data-testid="ws-unlock"');
    const btn = zone.slice(i, zone.indexOf('</button>', i));
    expect(btn).toContain('<LockIcon');
    expect(btn).toContain("t('ws.unlock')");
    expect(btn).toContain('ws.lock.signed');
    expect(btn).toContain('aria-label');
  });
  it('the copy: "Sblocca preventivo" in Italian, an equivalent in each language', () => {
    expect(DICT.it['ws.unlock']).toBe('Sblocca preventivo');
    for (const l of LANGS) expect(DICT[l]['ws.unlock'], l).toBeTruthy();
    expect(new Set(LANGS.map((l) => DICT[l]['ws.unlock'])).size).toBe(6);
  });
});
