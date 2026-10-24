// @vitest-environment happy-dom
// CUBRAX brand: 3/4 hard hat + technological lettering with a green X + "Un producto Japadigital", on OLED black.
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import SplashScreen from '../src/components/SplashScreen.jsx';
import { Logo, Wordmark } from '../src/components/ui.jsx';
import { BRAND, MARK_ART, MARK_DATA_URI, LETTER_PATHS, WORD, buildMarkSvg, buildLockupSvg, buildIconSvg, buildManifest, LOGO_FILE } from '../src/brand/icon.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
const render = async (node) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node)));
};
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe('isotype: dimension line + 3/4 hard hat + ruler', () => {
  it('has the three levels, in order: dimension line on top, hat in the middle, ruler at the bottom', () => {
    const svg = buildMarkSvg();
    expect(svg).toContain('aria-label="CUBRAX"');
    expect(svg).not.toMatch(/<rect[^>]*fill="#000/); // transparent: sits on the app's own black
    const dim = MARK_ART.indexOf('M96 82H416'); // dimension line + extension ticks + arrowheads
    const hat = MARK_ART.indexOf('url(#shell)', MARK_ART.indexOf('</defs>'));
    const ruler = MARK_ART.indexOf('<rect x="96" y="360"');
    expect(dim).toBeGreaterThan(-1);
    expect(hat).toBeGreaterThan(dim);
    expect(ruler).toBeGreaterThan(hat);
    expect(MARK_ART).toContain('M122 72L96 82L122 92'); // arrowheads
    expect(MARK_ART).toContain('url(#visor)'); // front visor
    expect(MARK_ART.match(/<rect x="3\d\d" y="\d+" width="3\d" height="9" rx="4.5"\/>/g)).toHaveLength(3); // ventilation slots
    expect(MARK_ART.match(/M\d+ 366V\d+/g)).toHaveLength(17); // graduations
    expect(MARK_DATA_URI.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('is built from arcs, lines and rounded rects only: no free-hand cubic curves that could deform the visor', () => {
    const ds = [...MARK_ART.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(ds.length).toBeGreaterThan(8);
    for (const d of ds) expect(d, d).not.toMatch(/[CcSsTt]/); // only M L H V A Q (tiny corner radius) Z
  });

  it('the app icon is the whole isotype on OLED black (any + maskable), identical to the in-app mark', () => {
    for (const maskable of [false, true]) {
      const svg = buildIconSvg({ maskable });
      expect(svg).toContain('fill="#000000"');
      expect(svg).toContain('url(#shell)');
      expect(svg).toContain(MARK_ART); // the same art, not a variant
      expect(svg).toContain('M96 82H416');
    }
    expect(buildManifest().icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('/logo.png is the full lockup: hat, CUBRAX letters with a green X, and the centred credit', () => {
    const svg = buildLockupSvg();
    expect(LOGO_FILE).toBe('logo.png');
    expect(svg).toContain('Un producto Japadigital');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain(`stroke="${BRAND.green}"`);
    expect(svg).toContain('url(#shell)');
  });
});

describe('lettering', () => {
  it('draws C U B R A X, white with the X in brand green, with no font dependency', async () => {
    expect(WORD).toBe('CUBRAX');
    expect(Object.keys(LETTER_PATHS)).toEqual([...WORD].filter((c, i, a) => a.indexOf(c) === i));
    await render(React.createElement(Wordmark, { height: 40 }));
    const paths = [...host.querySelectorAll('path')];
    expect(paths).toHaveLength(6);
    expect(paths.map((p) => p.getAttribute('stroke'))).toEqual(['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', BRAND.green]);
    expect(host.querySelector('text')).toBeNull();
  });

  it('Logo keeps the artwork proportions', async () => {
    await render(React.createElement(Logo, { size: 200 }));
    const img = host.querySelector('img');
    expect(img.getAttribute('src')).toBe(MARK_DATA_URI);
    expect(Number(img.getAttribute('height'))).toBe(200); // size = height
    expect(Number(img.getAttribute('width'))).toBeGreaterThan(200);
  });
});

describe('splash + dashboard', () => {
  it('the opening screen: hat, lettering (named CUBRAX for screen readers) and the centred credit at the bottom', async () => {
    await render(React.createElement(SplashScreen, { onStart: () => {}, auto: false }));
    const h1 = host.querySelector('h1');
    expect(h1.textContent).toBe('CUBRAX');
    expect(h1.querySelector('svg[data-testid="wordmark"]')).not.toBeNull();
    expect(host.querySelector('img')).not.toBeNull();
    const credit = host.querySelector('[data-testid="splash-credit"]');
    expect(credit.textContent).toBe('Un producto Japadigital');
    expect(credit.className).toContain('text-center');
  });

  it('the dashboard and the top bar carry the isotype at 34 px tall next to the CUBRAX lettering', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/Dashboard.jsx', 'utf8');
    expect(src).toContain('<Wordmark');
    expect(src).toContain('<Logo size={34}');
    expect(fs.readFileSync('src/components/Header.jsx', 'utf8')).toContain('<Logo size={34}');
    expect(fs.readFileSync('src/components/Header.jsx', 'utf8')).toContain('<Wordmark');
  });
});
