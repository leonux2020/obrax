import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Pure OLED rule: backgrounds are #000000; separation comes from ultra-thin borders, never grey fills.
const root = new URL('../src/', import.meta.url).pathname;
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(root).filter((f) => /\.(jsx?|css)$/.test(f));

describe('strict OLED theme', () => {
  it('no grey background utilities anywhere in src (neutral/gray/zinc/slate/stone fills)', () => {
    const offenders = [];
    for (const f of files) {
      // the documented exceptions: the 2 px track of the project header's single progress line (HeaderZone) and the dark circle of the
      // quick-control grid tiles (workspace/Block.jsx), the 1 px bars of the profitability x-ray and the specialty chips of the Squadra rows, all asked for by name
      const text = fs.readFileSync(f, 'utf8').replaceAll('h-0.5 bg-neutral-800', 'h-0.5').replaceAll('h-1 bg-neutral-800', 'h-1').replaceAll('bg-neutral-800 text-neutral-300', 'text-neutral-300').replaceAll('border-white/5 bg-neutral-900', 'border-white/5');
      const m = text.match(/(?:^|[^\w-])(?:[a-z-]+:)*bg-(?:neutral|gray|zinc|slate|stone)-\d+(?:\/\d+)?/g);
      if (m) offenders.push(`${path.relative(root, f)}: ${m.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no hard-coded grey/white page backgrounds in CSS or inline styles', () => {
    const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*background(-color)?:\s*#000/);
    const bad = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/g)) {
        if (!['#000', '#000000', '#22c55e', '#4ade80', '#fff', '#ffffff'].includes(m[1].toLowerCase())) bad.push(`${path.relative(root, f)}: ${m[1]}`);
      }
    }
    expect(bad.filter((b) => !b.includes('index.css'))).toEqual([]);
  });

  it('cards are black with an ultra-thin white/10 border', () => {
    const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.card\s*\{\s*@apply[^;]*border-white\/10[^;]*bg-black/);
  });

  it('manifest and meta theme are pure black', () => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<meta name="theme-color" content="#000000" />');
  });
});

describe('one-hand ergonomics', () => {
  const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

  it('main navigation and key actions are fixed to the bottom', () => {
    expect(read('components/BottomNav.jsx')).toMatch(/fixed inset-x-0 bottom-0/);
    expect(read('components/Wizard.jsx')).toMatch(/fixed inset-x-0 bottom-0/);
  });

  it('forms are bottom sheets anchored to the bottom edge', () => {
    const sheet = read('components/BottomSheet.jsx');
    expect(sheet).toMatch(/items-end/);
    expect(sheet).toMatch(/rounded-t-3xl/);
    for (const f of ['ProjectSheet', 'ProfileSheet']) expect(read(`components/${f}.jsx`)).toContain('BottomSheet');
  });

  it('touch targets are at least 44 px', () => {
    expect(read('components/BottomNav.jsx')).toMatch(/min-h-\[56px\]/);
    // the whole card is one big button (no tiny Open / Edit buttons) and the FAB is 52 px (still above the 44 px minimum)
    expect(read('components/ProjectCard.jsx')).toMatch(/block w-full[^"]*p-4/);
    const dash = read('components/Dashboard.jsx');
    expect(dash).toMatch(/h-\[52px\] w-\[52px\]/);
    expect(dash).not.toMatch(/h-16 w-16/);
    expect(dash).toContain('<svg width="24" height="24"'); // the + shrank with the button
    // calmer on OLED: a tone darker than the brand green and a soft, low-alpha shadow instead of the 24 px / .35 glow
    const fab = dash.slice(dash.indexOf('data-testid="fab-new"'));
    expect(fab).toContain('bg-brand-dark');
    expect(fab).toContain('shadow-[0_2px_10px_rgba(22,163,74,0.22)]');
    expect(fab).not.toContain('0_0_24px');
    expect(dash).toMatch(/pb-44/); // the last card scrolls fully above the button
  });
});
