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
      const text = fs.readFileSync(f, 'utf8');
      const m = text.match(/(?:^|[^\w-])(?:[a-z-]+:)*bg-(?:neutral|gray|zinc|slate|stone)-\d+(?:\/\d+)?/g);
      if (m) offenders.push(`${path.relative(root, f)}: ${m.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no hard-coded grey/white page backgrounds in CSS or inline styles', () => {
    const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*background:\s*#000/);
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
    for (const f of ['ProjectSheet', 'SettingsSheet', 'ProfileSheet']) expect(read(`components/${f}.jsx`)).toContain('BottomSheet');
  });

  it('touch targets are at least 44 px', () => {
    expect(read('components/BottomNav.jsx')).toMatch(/min-h-\[56px\]/);
    // the whole card is one big button (no tiny Open / Edit buttons) and the FAB is 64 px
    expect(read('components/ProjectCard.jsx')).toMatch(/block w-full[^"]*p-4/);
    expect(read('components/Dashboard.jsx')).toMatch(/h-16 w-16/);
  });
});
