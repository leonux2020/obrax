// Visual-ergonomics calibration: no pure white text, no heavy weights, fixed-width digits, grayscale antialiasing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(jsx?|css)$/.test(e.name)) out.push(f);
  }
  return out;
};
const files = walk('src');
const hits = (re) => files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => (re.test(l) ? `${f}:${i + 1}` : null)).filter(Boolean));

describe('legibility calibration', () => {
  it('no solid-white text class is left (translucent text-white/NN greys are fine)', () => {
    expect(hits(/(?<![\w:/-])(?:hover:|active:|focus:)?text-white(?![\w/-])/)).toEqual([]);
  });
  it('no bold / extrabold / black weights anywhere: semibold at most', () => {
    expect(hits(/(?<![\w-])font-(?:bold|extrabold|black)(?![\w-])/)).toEqual([]);
  });
  it('every tabular-nums money figure is medium weight, never semibold; giant metrics are medium + tracking-tight', () => {
    const bad = files.flatMap((f) =>
      [...fs.readFileSync(f, 'utf8').matchAll(/["'`]([^"'`\n$]*tabular-nums[^"'`\n$]*)["'`]/g)].filter((m) => /(?<![\w-])font-semibold(?![\w-])/.test(m[1])).map((m) => `${f}: ${m[1]}`)
    );
    expect(bad).toEqual([]);
    const giants = hits(/(?<![\w:-])text-(?:3xl|4xl|5xl|6xl)(?![\w-])(?=[^\n]*tabular-nums)(?![^\n]*tracking-tight)/);
    expect(giants).toEqual([]);
  });
  it('the financial metrics (DISPONIBILE, totals, keypad display) are medium + tracking-tight + tabular-nums', () => {
    for (const f of ['src/components/GlobalAccounting.jsx']) {
      expect(fs.readFileSync(f, 'utf8')).toMatch(/font-medium tracking-tight tabular-nums \$\{sizeFor/);
    }
    expect(fs.readFileSync('src/components/workspace/NumberPad.jsx', 'utf8')).toContain('text-5xl font-medium tracking-tight tabular-nums');
  });
  it('money and dates are rendered in tabular-nums components (CashBlock, Rendiconto, Dashboard...)', () => {
    for (const f of ['src/components/workspace/CashBlock.jsx', 'src/components/workspace/ReceiptStack.jsx', 'src/components/GlobalAccounting.jsx', 'src/components/Dashboard.jsx', 'src/components/ProjectCard.jsx']) {
      expect(fs.readFileSync(f, 'utf8'), f).toContain('tabular-nums');
    }
  });
  it('the body is antialiased, off-white and fixed-width by default (CSS and first paint)', () => {
    const css = fs.readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/body \{[^}]*@apply antialiased text-neutral-200 tabular-nums;/s);
    expect(css).toMatch(/color: #e5e5e5;/);
    expect(css).not.toMatch(/color: #fff;/);
    expect(fs.readFileSync('index.html', 'utf8')).toContain('color: #e5e5e5;');
  });
});
