// @vitest-environment happy-dom
// CUBRAX brand: supplied photoreal hard hat + static SVG dimension line / ruler, Montserrat SemiBold lettering with a green X.
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import SplashScreen from '../src/components/SplashScreen.jsx';
import { Logo, Wordmark } from '../src/components/ui.jsx';
import fs from 'node:fs';
import { BRAND, MARK_LAYOUT, DIM_ART, RULER_ART, HELMET_FILE, HELMET_RATIO, LETTER_PATHS, WORD, WORD_BOX, buildMarkSvg, buildLockupSvg, buildIconSvg, buildManifest, LOGO_FILE } from '../src/brand/icon.js';
import { WORD_WEIGHT } from '../src/brand/wordArt.js';

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

describe('isotype: static dimension line + supplied photoreal hard hat + static ruler', () => {
  it('the hat is the supplied PNG (public/helmet.png), not code: no procedural geometry is left in the repo', () => {
    expect(HELMET_FILE).toBe('helmet.png');
    const png = fs.readFileSync('public/helmet.png');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const ratio = png.readUInt32BE(16) / png.readUInt32BE(20); // IHDR width / height
    expect(ratio).toBeCloseTo(HELMET_RATIO, 2);
    expect(fs.existsSync('src/brand/markArt.js')).toBe(false);
    expect(fs.existsSync('scripts/gen-brand-mark.mjs')).toBe(false);
    expect(fs.readFileSync('src/brand/icon.js', 'utf8')).not.toMatch(/ellipsoid|catmull|url\(#shell\)|url\(#visor\)/i);
  });

  it('three levels in order: dimension line, hat <image> (meet = object-fit contain), ruler; transparent background', () => {
    const svg = buildMarkSvg();
    expect(svg).toContain('aria-label="CUBRAX"');
    expect(svg).not.toMatch(/<rect[^>]*fill="#000/);
    const dim = svg.indexOf(DIM_ART);
    const img = svg.indexOf('<image ');
    const ruler = svg.indexOf(RULER_ART);
    expect(dim).toBeGreaterThan(-1);
    expect(img).toBeGreaterThan(dim);
    expect(ruler).toBeGreaterThan(img);
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain(`href="./${HELMET_FILE}"`);
    expect(buildMarkSvg({ helmetHref: 'data:image/png;base64,AAAA' })).toContain('href="data:image/png;base64,AAAA"');
  });

  it('vertical rhythm: 14-30 units of transparent air above and below the hat; the hat box keeps the PNG proportions', () => {
    const { dimension, helmet, ruler, gapTop, gapBottom, w } = MARK_LAYOUT;
    expect(gapTop).toBeGreaterThanOrEqual(14);
    expect(gapTop).toBeLessThanOrEqual(30);
    expect(gapBottom).toBeGreaterThanOrEqual(14);
    expect(gapBottom).toBeLessThanOrEqual(30);
    expect(helmet.y - (dimension.y + dimension.h)).toBe(gapTop);
    expect(ruler.y - (helmet.y + helmet.h)).toBe(gapBottom);
    expect(w / helmet.h).toBeCloseTo(HELMET_RATIO, 1);
    expect(dimension.h).toBeLessThan(helmet.h / 5); // the dimension line and the ruler are slim next to the hat
    expect(ruler.h).toBeLessThan(helmet.h / 3);
  });

  it('the dimension line is exactly as wide as the hat and has arrowheads; the ruler has 19 graduations and a green hook', () => {
    expect(DIM_ART).toContain('M6 14H354');
    expect(DIM_ART.match(/L6 14L|L354 14L/g)).toHaveLength(2);
    expect(RULER_ART.match(/V\d+(?=M|")/g).length).toBe(19);
    expect(RULER_ART).toContain('fill="#22c55e"');
    expect(DIM_ART + RULER_ART).not.toContain('<image');
  });

  it('the app icon and the lockup draw the same three levels on OLED black (any + maskable)', () => {
    for (const maskable of [false, true]) {
      const svg = buildIconSvg({ maskable });
      expect(svg).toContain('fill="#000000"');
      expect(svg).toContain(DIM_ART);
      expect(svg).toContain(RULER_ART);
      expect(svg).toContain('<image ');
    }
    expect(buildManifest().icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('/logo.png is the full lockup: isotype, CUBRAX letters with a green X, and the centred credit', () => {
    const svg = buildLockupSvg();
    expect(LOGO_FILE).toBe('logo.png');
    expect(svg).toContain(DIM_ART);
    expect(svg).toContain('<image ');
    expect(svg).toContain('Un producto Japadigital');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain(`fill="${BRAND.green}"`);
  });
});

describe('lettering', () => {
  it('is Montserrat Medium/SemiBold outlines (never ExtraBold): filled glyphs, no strokes, no font dependency, no stencil cuts', async () => {
    expect(WORD).toBe('CUBRAX');
    expect([500, 600]).toContain(WORD_WEIGHT);
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

  it('Logo takes its size as HEIGHT: <img> hat with object-fit contain between the two SVG levels, undistorted', async () => {
    await render(React.createElement(Logo, { size: 200 }));
    const img = host.querySelector('img[data-testid="logo-helmet"]');
    expect(img.getAttribute('src')).toMatch(/helmet\.png$/);
    expect(img.style.objectFit).toBe('contain');
    const k = 200 / MARK_LAYOUT.h;
    expect(parseFloat(img.style.height)).toBeCloseTo(MARK_LAYOUT.helmet.h * k, 1);
    expect(parseFloat(img.style.width)).toBeCloseTo(MARK_LAYOUT.w * k, 0);
    const svgs = [...host.querySelectorAll('[data-testid="logo"] svg')];
    expect(svgs).toHaveLength(2);
    // order in the DOM: dimension svg, img, ruler svg
    const order = [...host.querySelector('[data-testid="logo"]').querySelectorAll('svg, img')].map((n) => n.tagName.toLowerCase());
    expect(order).toEqual(['svg', 'img', 'svg']);
    expect(host.querySelector('[data-testid="logo"]').style.height).toBe('200px');
  });

  it('scales to 32 px tall keeping the hat proportions and the air between levels', async () => {
    await render(React.createElement(Logo, { size: 32 }));
    const k = 32 / MARK_LAYOUT.h;
    const img = host.querySelector('img');
    expect(host.querySelector('[data-testid="logo"]').style.height).toBe('32px');
    expect(parseFloat(img.style.width) / parseFloat(img.style.height)).toBeCloseTo(HELMET_RATIO, 1);
    expect(parseFloat(img.style.marginTop)).toBeCloseTo(MARK_LAYOUT.gapTop * k, 1);
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
