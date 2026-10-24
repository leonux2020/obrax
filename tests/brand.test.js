// @vitest-environment happy-dom
// CUBRAX brand: 3/4 hard hat + technological lettering with a green X + "Un producto Japadigital", on OLED black.
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import SplashScreen from '../src/components/SplashScreen.jsx';
import { Logo, Wordmark } from '../src/components/ui.jsx';
import { BRAND, MARK_ART, MARK_BOX, MARK_LAYOUT, MARK_RATIO, MARK_DATA_URI, LETTER_PATHS, WORD, buildMarkSvg, buildLockupSvg, buildIconSvg, buildManifest, LOGO_FILE } from '../src/brand/icon.js';

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
  it('has the three levels in order: dimension line on top, hat in the middle, ruler at the bottom', () => {
    const svg = buildMarkSvg();
    expect(svg).toContain('aria-label="CUBRAX"');
    expect(svg).not.toMatch(/<rect[^>]*fill="#000/); // transparent: sits on the app's own black
    const dim = MARK_ART.indexOf('stroke-width="8"');
    const hat = MARK_ART.indexOf('fill="url(#shell)"');
    const ruler = MARK_ART.indexOf('rx="6" fill="#ffffff"');
    expect(dim).toBeGreaterThan(-1);
    expect(hat).toBeGreaterThan(dim);
    expect(ruler).toBeGreaterThan(hat);
    expect(MARK_DATA_URI.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('vertical rhythm: a clean transparent margin of at least 14 units between hat and ruler, and between dimension line and hat', () => {
    const { helmet, ruler, dimension } = MARK_LAYOUT;
    expect(ruler.y - helmet.bottom).toBeGreaterThanOrEqual(14);
    expect(MARK_LAYOUT.gap).toBeGreaterThanOrEqual(14);
    expect(helmet.top - dimension.y).toBeGreaterThanOrEqual(14 + 15); // 15 = half the extension ticks
    // the dimension line is exactly as wide as the helmet (it never overflows it) and the box is centred on it
    expect(dimension.x0 + dimension.x1).toBeCloseTo(512, 0);
    expect(MARK_BOX.x + MARK_BOX.w / 2).toBeCloseTo(256, 0);
  });

  it('the visor is part of ONE opaque body: a single brim outline + edge, solid gradients, nothing translucent or stroked on its own', () => {
    expect(MARK_ART.match(/fill="url\(#visor\)"/g)).toHaveLength(1); // one brim top face that already contains the visor
    const grad = MARK_ART.match(/<linearGradient id="visor"[\s\S]*?<\/linearGradient>/)[0];
    expect(grad).not.toContain('stop-opacity');
    expect(MARK_ART).not.toMatch(/<path[^>]*url\(#visor\)[^>]*(stroke|opacity)/);
  });

  it('ribs, crest highlight and three ventilation slots are drawn on the shell (clipped to it), with subtle light and shade', () => {
    expect(MARK_ART).toContain('clip-path="url(#dome)"');
    expect(MARK_ART.match(/fill="#052e16" fill-opacity="\.9"/g)).toHaveLength(3); // slots
    expect(MARK_ART.match(/stroke="#052e16" stroke-opacity="\.38"/g).length).toBeGreaterThanOrEqual(1); // ribs
    expect(MARK_ART).toContain('url(#lit)');
    expect(MARK_ART).toContain('url(#shade)');
  });

  it('the ruler has 19 graduations and the dimension line has arrowheads at both ends', () => {
    expect(MARK_ART.match(/V\d+(?=M|")/g).length).toBeGreaterThanOrEqual(19);
    expect(MARK_ART.match(/L[\d.]+ [\d.]+L[\d.]+ [\d.]+"|M[\d.]+ [\d.]+L[\d.]+ [\d.]+L[\d.]+ [\d.]+/g).length).toBeGreaterThan(0);
  });

  it('the app icon is the whole isotype on OLED black (any + maskable), identical to the in-app mark', () => {
    for (const maskable of [false, true]) {
      const svg = buildIconSvg({ maskable });
      expect(svg).toContain('fill="#000000"');
      expect(svg).toContain(MARK_ART); // the same art, not a variant
    }
    expect(buildManifest().icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(buildMarkSvg()).toContain(MARK_ART);
  });

  it('/logo.png is the full lockup: isotype, CUBRAX letters with a green X, and the centred credit', () => {
    const svg = buildLockupSvg();
    expect(LOGO_FILE).toBe('logo.png');
    expect(svg).toContain(MARK_ART);
    expect(svg).toContain('Un producto Japadigital');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain(`fill="${BRAND.green}"`);
  });
});

describe('lettering', () => {
  it('is a geometric sans (Montserrat ExtraBold outlines): filled glyphs, no strokes, no font dependency, no stencil cuts', async () => {
    expect(WORD).toBe('CUBRAX');
    for (const c of 'CUBRAX') {
      expect(LETTER_PATHS[c], c).toMatch(/^M/);
      if ('CUBR'.includes(c)) expect(LETTER_PATHS[c], c).toMatch(/[CQ]/); // real round curves, not 45-degree cut polygons
    }
    await render(React.createElement(Wordmark, { height: 40 }));
    const paths = [...host.querySelectorAll('path')];
    expect(paths).toHaveLength(6);
    expect(paths.map((p) => p.getAttribute('fill'))).toEqual(['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', BRAND.green]); // CUBRA white, only X green
    expect(host.innerHTML).not.toContain('stroke');
    expect(host.querySelector('text')).toBeNull();
  });

  it('Logo takes its size as HEIGHT and keeps the artwork proportions', async () => {
    await render(React.createElement(Logo, { size: 200 }));
    const img = host.querySelector('img');
    expect(img.getAttribute('src')).toBe(MARK_DATA_URI);
    expect(Number(img.getAttribute('height'))).toBe(200);
    expect(Number(img.getAttribute('width'))).toBe(Math.round(200 / MARK_RATIO));
  });

  it('keeps sharp proportions when reduced to 32 px (same viewBox, no fixed pixel strokes)', async () => {
    await render(React.createElement(Logo, { size: 32 }));
    const img = host.querySelector('img');
    expect(img.getAttribute('height')).toBe('32');
    expect(buildMarkSvg()).toMatch(/viewBox="[\d.-]+ [\d.-]+ [\d.]+ [\d.]+"/);
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

  it('the dashboard and the top bar carry the isotype at 32 px tall next to the CUBRAX lettering', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/Dashboard.jsx', 'utf8');
    expect(src).toContain('<Wordmark');
    expect(src).toContain('<Logo size={32}');
    expect(fs.readFileSync('src/components/Header.jsx', 'utf8')).toContain('<Logo size={32}');
    expect(fs.readFileSync('src/components/Header.jsx', 'utf8')).toContain('<Wordmark');
  });
});
