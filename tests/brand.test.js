// @vitest-environment happy-dom
// CUBRAX brand: supplied photoreal hard hat + static SVG dimension line / ruler, Montserrat SemiBold lettering with a green X.
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import SplashScreen from '../src/components/SplashScreen.jsx';
import { Logo, Wordmark } from '../src/components/ui.jsx';
import fs from 'node:fs';
import { BRAND, MARK_LAYOUT, DIM_ART, RULER_ART, HELMET_FILE, HELMET_RATIO, LETTER_PATHS, WORD, WORD_BOX, buildMarkSvg, buildLockupSvg, buildIconSvg, buildManifest, LOGO_FILE, PNG_ICONS, ICON_LAYOUT, ICON_FILL, iconScale } from '../src/brand/icon.js';
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
    expect(paths.map((p) => p.getAttribute('fill'))).toEqual(['#e5e5e5', '#e5e5e5', '#e5e5e5', '#e5e5e5', '#e5e5e5', BRAND.green]); // CUBRA light grey (off-white), only X green
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
  it('the welcome screen (first browser visit) draws the stacked imagotype (hard hat + CUBRAX under it) above the button and no credit', async () => {
    await render(React.createElement(SplashScreen, { onStart: () => {}, auto: false }));
    const h1 = host.querySelector('h1');
    expect(h1.textContent).toBe('CUBRAX');
    expect(h1.className).toContain('sr-only');
    expect(host.querySelector('[data-testid="splash-logo"] image[data-testid="logo-helmet"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="splash-logo"] [data-testid="logo-word"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="splash-credit"]')).toBeNull();
    expect(host.querySelector('[data-testid="splash-start"]')).not.toBeNull();
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

describe('app icons: hat + CUBRAX as one centred lockup (the OS draws it as the splash)', () => {
  it('every icon SVG embeds the lettering (6 glyph paths, green X) below the ruler, on solid #000000', () => {
    for (const maskable of [false, true]) {
      const svg = buildIconSvg({ maskable });
      expect(svg).toContain('fill="#000000"');
      for (const c of WORD) expect(svg).toContain(`d="${LETTER_PATHS[c]}"`);
      expect(svg).toContain(`fill="${BRAND.green}"`);
      expect(svg).toContain(RULER_ART);
      // the lettering starts under the ruler (its translate Y is below the isotype's height)
      expect(ICON_LAYOUT.wordTop).toBeGreaterThan(MARK_LAYOUT.h);
    }
    expect(ICON_FILL).toBeGreaterThanOrEqual(0.6);
    expect(ICON_FILL).toBeLessThanOrEqual(0.7);
  });

  it('the generated PNGs (192, 512, maskable 512, apple 180): lockup centred, filling 60-70 % of the height; maskable inside the safe circle', async () => {
    const sharp = (await import('sharp')).default;
    const fs = await import('node:fs');
    const helmet = `data:image/png;base64,${fs.readFileSync('public/helmet.png').toString('base64')}`;
    for (const def of PNG_ICONS) {
      const svg = buildIconSvg({ maskable: def.maskable, helmetHref: helmet });
      const { data, info } = await sharp(Buffer.from(svg), { density: 384 }).resize(def.size, def.size).flatten({ background: '#000000' }).raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(def.size);
      expect(info.height).toBe(def.size);
      let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
      let corner = 0;
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          const i = (y * info.width + x) * info.channels;
          const lit = data[i] + data[i + 1] + data[i + 2] > 60;
          if (lit) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
      corner = data[0] + data[1] + data[2];
      const s = def.size;
      expect(corner).toBe(0); // solid black background, corners included
      expect(Math.abs((minX + maxX) / 2 - s / 2)).toBeLessThanOrEqual(s * 0.02); // centred horizontally
      expect(Math.abs((minY + maxY) / 2 - s / 2)).toBeLessThanOrEqual(s * 0.02); // and vertically
      const heightShare = (maxY - minY + 1) / s;
      expect(heightShare).toBeGreaterThanOrEqual(0.58);
      expect(heightShare).toBeLessThanOrEqual(0.72);
      if (def.maskable) {
        // every lit pixel is inside the 80 % safe circle
        const r = 0.4 * s;
        for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) expect(Math.hypot(x - s / 2, y - s / 2)).toBeLessThanOrEqual(r + 1);
      }
    }
    expect(iconScale(true)).toBeLessThanOrEqual(iconScale(false));
  }, 60000);
});

describe('Logo variant="imagotype" (isotype + CUBRAX lettering)', () => {
  it('one rectangular SVG whose viewBox is the whole lockup: nothing cut, the lettering to the right of the hat and vertically centred', async () => {
    const { IMAGO_LAYOUT, MARK_LAYOUT } = await import('../src/brand/icon.js');
    await render(React.createElement(Logo, { variant: 'imagotype', className: 'h-24 w-auto' }));
    const svg = host.querySelector('[data-testid="logo"]');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${IMAGO_LAYOUT.w} ${IMAGO_LAYOUT.h}`);
    expect(IMAGO_LAYOUT.w / IMAGO_LAYOUT.h).toBeGreaterThan(2.5); // a wide rectangle, not a square
    const { word } = IMAGO_LAYOUT;
    expect(word.x).toBeGreaterThanOrEqual(MARK_LAYOUT.w); // never over the hat
    expect(word.x + word.w).toBeLessThanOrEqual(IMAGO_LAYOUT.w); // inside the box
    expect(word.y).toBeGreaterThan(0);
    expect(word.y + word.h).toBeLessThanOrEqual(IMAGO_LAYOUT.h);
    expect(Math.abs(word.y + word.h / 2 - IMAGO_LAYOUT.h / 2)).toBeLessThanOrEqual(1);
    expect(svg.getAttribute('aria-label')).toBe('CUBRAX');
  });

  it('"CUBRA" is light grey #e5e5e5 and ONLY the X is brand green #22c55e', async () => {
    await render(React.createElement(Logo, { variant: 'imagotype' }));
    const letters = [...host.querySelectorAll('[data-testid="logo-word"] path')];
    expect(letters.map((p) => p.getAttribute('data-letter')).join('')).toBe('CUBRAX');
    for (const p of letters) expect(p.getAttribute('fill')).toBe(p.getAttribute('data-letter') === 'X' ? '#22c55e' : '#e5e5e5');
    expect(host.querySelector('[data-testid="logo"]').innerHTML.toLowerCase()).not.toMatch(/#fff(fff)?\b/); // no pure white anywhere in the lockup
  });

  it('the default Logo (header, dashboard) is unchanged: isotype only, sized by height', async () => {
    await render(React.createElement(Logo, { size: 32 }));
    expect(host.querySelector('[data-testid="logo"]').style.height).toBe('32px');
    expect(host.querySelector('[data-testid="logo-word"]')).toBeNull();
  });
});

describe('Logo variant="stacked" (CUBRAX centred under the hat and the ruler)', () => {
  it('the viewBox is the whole vertical lockup: lettering below the ruler, centred on the same axis as the hat, inside the box', async () => {
    const { ICON_LAYOUT, MARK_LAYOUT } = await import('../src/brand/icon.js');
    await render(React.createElement(Logo, { variant: 'stacked', className: 'w-56 h-auto' }));
    const svg = host.querySelector('[data-testid="logo"]');
    expect(svg.getAttribute('data-variant')).toBe('stacked');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${ICON_LAYOUT.w} ${ICON_LAYOUT.h}`);
    expect(ICON_LAYOUT.h / ICON_LAYOUT.w).toBeGreaterThan(1.1); // taller than wide
    const word = svg.querySelector('[data-testid="logo-word"]');
    expect(Number(word.getAttribute('y'))).toBeGreaterThanOrEqual(MARK_LAYOUT.h); // under the ruler
    expect(Number(word.getAttribute('y')) + Number(word.getAttribute('height'))).toBeLessThanOrEqual(ICON_LAYOUT.h);
    const wordCentre = Number(word.getAttribute('x')) + Number(word.getAttribute('width')) / 2;
    const hatCentre = ICON_LAYOUT.markX + MARK_LAYOUT.w / 2;
    expect(Math.abs(wordCentre - hatCentre)).toBeLessThanOrEqual(1); // exactly centred under the hat
    expect(svg.querySelector('image[data-testid="logo-helmet"]')).not.toBeNull();
  });

  it('"CUBRA" #e5e5e5 and only the X #22c55e', async () => {
    await render(React.createElement(Logo, { variant: 'stacked' }));
    const letters = [...host.querySelectorAll('[data-testid="logo-word"] path')];
    expect(letters.map((p) => p.getAttribute('data-letter')).join('')).toBe('CUBRAX');
    for (const p of letters) expect(p.getAttribute('fill')).toBe(p.getAttribute('data-letter') === 'X' ? '#22c55e' : '#e5e5e5');
  });
});
