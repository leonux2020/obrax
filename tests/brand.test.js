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

describe('hard hat mark', () => {
  it('has the shell, centre crest, front visor (bill) and three ventilation slots, all in green on transparent', () => {
    const svg = buildMarkSvg();
    expect(svg).toContain('aria-label="CUBRAX"');
    expect(svg).not.toMatch(/<rect[^>]*fill="#000/); // transparent: sits on the app's own black
    expect(MARK_ART).toContain('url(#shell)');
    expect(MARK_ART).toContain('url(#crest)');
    expect(MARK_ART).toContain('url(#bill)'); // front visor
    expect(MARK_ART.match(/stroke="#052e16" stroke-width="15"/g)).toHaveLength(1);
    expect(MARK_ART.match(/<path d="M3\d\d \d+L\d+ \d+"\/>|<path d="M\d+ \d+L\d+ \d+"\/><path d="M\d+ \d+L\d+ \d+"\/><path d="M\d+ \d+L\d+ \d+"\/>/g)?.length).toBeGreaterThan(0);
    expect(MARK_DATA_URI.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('the app icon is the hat on OLED black (any + maskable), not the old blueprint / tape artwork', () => {
    for (const maskable of [false, true]) {
      const svg = buildIconSvg({ maskable });
      expect(svg).toContain('fill="#000000"');
      expect(svg).toContain('url(#shell)');
      expect(svg).not.toMatch(/tape|blueprint/i);
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
    expect(Number(img.getAttribute('height'))).toBeLessThan(200);
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

  it('the dashboard header carries the new mark and lettering (source check)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/Dashboard.jsx', 'utf8');
    expect(src).toContain('<Wordmark');
    expect(src).toContain('<Logo');
  });
});
