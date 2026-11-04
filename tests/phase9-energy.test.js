// @vitest-environment happy-dom
// Phase 9: sustainability. Pure OLED black, no background network traffic, and motion that is REMOVED (not slowed) when asked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchCardWeather } from '../src/lib/weatherService.js';
import { RESUME_MS, isHidden, onForeground } from '../src/lib/foreground.js';
import { calmMotion, scrollBehavior } from '../src/lib/motion.js';

const read = (p) => readFileSync(p, 'utf8');
const css = read('src/index.css');
const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const okFetch = () =>
  vi.fn(async () => ({ ok: true, json: async () => ({ current: { temperature_2m: 21, weather_code: 0, wind_speed_10m: 8, is_day: 1 } }) }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

afterEach(() => setVisibility('visible'));

describe('1. pure OLED black', () => {
  it('the three base layers, the HTML shell and the manifest are #000000; no off-black greys', () => {
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{\s*background-color:\s*#000000;/);
    expect(read('index.html')).toContain('background-color: #000000');
    expect(read('index.html')).toContain('<meta name="theme-color" content="#000000"');
    expect(read('src/brand/icon.js')).toMatch(/black:\s*'#000000'/);
    for (const f of ['src/components/BottomSheet.jsx', 'src/components/workspace/NumberPad.jsx', 'src/components/Dashboard.jsx', 'src/components/workspace/Dock.jsx']) {
      expect(read(f), f).not.toMatch(/neutral-950|neutral-900\/|bg-\[#(0a|11|12|1a)/i);
    }
    expect(read('src/components/BottomSheet.jsx')).toMatch(/border border-white\/10 bg-black/);
    expect(read('src/components/workspace/NumberPad.jsx')).toMatch(/border-white\/10 bg-black/);
    expect(read('tailwind.config.js')).not.toMatch(/950/);
  });
});

describe('2. Smart Sync: nothing non-critical leaves the device in the background', () => {
  it('foreground helper: isHidden follows visibilityState and onForeground resumes softly, once per return', async () => {
    expect(isHidden()).toBe(false);
    const cb = vi.fn();
    const off = onForeground(cb, { delay: 20 });
    setVisibility('hidden');
    expect(isHidden()).toBe(true);
    await wait(40);
    expect(cb).not.toHaveBeenCalled(); // going to the background never triggers it
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled(); // soft: not in the very same frame
    await wait(40);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setVisibility('hidden');
    setVisibility('visible');
    await wait(40);
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
    expect(RESUME_MS).toBeGreaterThanOrEqual(300);
  });

  it('the weather lookup waits in the background (no request) and runs once the app is back in front', async () => {
    setVisibility('hidden');
    const fetchImpl = okFetch();
    const place = { key: 'gps:1.11,2.22', lat: 1.11, lng: 2.22 };
    const pending = fetchCardWeather(place, { fetchImpl, storage: memory() });
    await wait(80);
    expect(fetchImpl).not.toHaveBeenCalled(); // paused immediately
    setVisibility('visible');
    await wait(RESUME_MS - 300);
    expect(fetchImpl).not.toHaveBeenCalled(); // reactivated softly, not at once
    const wx = await pending;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(wx?.temp).toBe(21);
  });

  it('in the foreground the lookup is unchanged (no extra delay)', async () => {
    const fetchImpl = okFetch();
    const wx = await fetchCardWeather({ key: 'gps:3.33,4.44', lat: 3.33, lng: 4.44 }, { fetchImpl, storage: memory() });
    expect(wx?.temp).toBe(21);
  });

  it('every non-critical timer / hook checks the visibility; the user data flush does not', () => {
    expect(read('src/lib/useCardWeather.js')).toMatch(/isHidden\(\)\) return/);
    expect(read('src/lib/useCardWeather.js')).toContain('onForeground(run)');
    expect(read('src/components/workspace/WeatherChip.jsx')).toMatch(/isHidden\(\)\) return/);
    expect(read('src/components/workspace/WeatherChip.jsx')).toContain('onForeground(run)');
    expect(read('src/components/Dashboard.jsx')).toMatch(/setInterval\(\(\) => document\.visibilityState !== 'hidden' && tick\(\)/);
    for (const f of ['src/lib/useExportSync.js', 'src/lib/useReceiptSync.js']) expect(read(f), f).toMatch(/document\.visibilityState !== 'hidden' && run\(\)/);
    // saving the user's own work must still run when the app goes to the background
    expect(read('src/App.jsx')).toMatch(/visibilityState === 'hidden' && flush\(\)/);
  });
});

describe('3. Eco-mode and reduced motion REMOVE the animations', () => {
  const block = (start) => {
    const i = css.indexOf(start);
    return css.slice(i, css.indexOf('\n}\n', i));
  };
  it('prefers-reduced-motion: no animation, no transition, no smooth scroll, on elements and pseudo-elements', () => {
    const b = block('@media (prefers-reduced-motion: reduce) {');
    expect(b).toMatch(/\*,\s*\*::before,\s*\*::after/);
    expect(b).toContain('animation: none !important');
    expect(b).toContain('transition: none !important');
    expect(b).toContain('scroll-behavior: auto !important');
    expect(b).not.toMatch(/animation-duration|transition-duration/); // "none", never "a bit faster"
  });
  it('body.eco-mode: the same, plus no blur / compositing hints', () => {
    const i = css.indexOf('body.eco-mode,');
    const b = css.slice(i, css.indexOf('/* Printing', i));
    for (const sel of ['body.eco-mode *', 'body.eco-mode *::before', 'body.eco-mode *::after']) expect(b).toContain(sel);
    expect(b).toContain('animation: none !important');
    expect(b).toContain('transition: none !important');
    expect(b).toContain('will-change: auto !important');
    expect(b).toContain('backdrop-filter: none !important');
    expect(b).not.toMatch(/animation-duration|transition-duration/);
  });
  it('the JS side asks the same question: smooth scrolling becomes instant', () => {
    expect(scrollBehavior()).toBe('smooth');
    document.body.classList.add('eco-mode');
    expect(calmMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
    document.body.classList.remove('eco-mode');
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({ matches: q.includes('reduce'), media: q }));
    expect(scrollBehavior()).toBe('auto');
    mm.mockRestore();
    expect(read('src/components/PhotoLightbox.jsx')).toContain('behavior: scrollBehavior()');
  });
});
