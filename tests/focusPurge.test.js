// "Zero grid effect": no focus rectangle on touch targets (closing a sheet returns the focus to its tile).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/index.css', 'utf8');
const block = readFileSync('src/components/workspace/Block.jsx', 'utf8');
const workspace = readFileSync('src/components/ProjectWorkspace.jsx', 'utf8');

describe('focus purge', () => {
  it('the global stylesheet clears the tap highlight everywhere', () => {
    expect(css).toMatch(/\*\s*\{\s*-webkit-tap-highlight-color:\s*transparent\s*!important;/);
  });
  it('buttons, links, role=button and focusable divs never show an outline or a shadow on focus', () => {
    const rule = css.match(/button:focus,[\s\S]*?\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    for (const sel of ['button:focus', 'a:focus', "[role='button']:focus", 'div[tabindex]:focus', 'button:focus-visible']) expect(css).toContain(sel);
    expect(rule[1]).toMatch(/outline:\s*none\s*!important/);
    expect(rule[1]).toMatch(/box-shadow:\s*none\s*!important/);
  });
  it('the circular tiles of the workspace carry no focus ring / border classes, only the passive touch state', () => {
    for (const src of [block, workspace]) expect(src).not.toMatch(/focus(-visible)?:(ring|border|outline)/);
    expect(block).toContain('active:scale-95');
  });
});
