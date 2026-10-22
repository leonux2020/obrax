import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { LOGO_LIMITS, compressLogo, compressLogoSource, normalizeLogo } from '../src/lib/logo.js';
import { dataUrlBytes } from '../src/lib/photos.js';
import { createLogoStore, idbLogoBackend, memoryLogoBackend } from '../src/lib/companyStore.js';

// Fake canvas environment: PNG weight = w*h*pngFactor bytes (WebP is lighter).
function fakeEnv(pngFactor = 0.25) {
  const canvases = [];
  const makeCanvas = () => {
    const calls = { types: [], draws: [], smoothing: [], cleared: 0, sizes: [] };
    const canvas = {
      _w: 300,
      _h: 150,
      sized: false,
      calls,
      get width() { return this._w; },
      set width(v) { this._w = v; this.sized = true; },
      get height() { return this._h; },
      set height(v) { this._h = v; },
      getContext() {
        const ctx = {
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
          clearRect() { calls.cleared += 1; },
          fillRect() { throw new Error('logo must stay transparent: no fillRect'); },
          drawImage: (src, x, y, w, h) => {
            calls.draws.push({ w, h });
            calls.smoothing.push([ctx.imageSmoothingEnabled, ctx.imageSmoothingQuality]);
          },
        };
        return ctx;
      },
      toDataURL(type) {
        calls.types.push(type);
        calls.sizes.push([this._w, this._h]); // size at encode time (canvases are released afterwards)
        const factor = type === 'image/webp' ? pngFactor * 0.4 : pngFactor;
        const n = Math.ceil((Math.round(this._w * this._h * factor) * 4) / 3 / 4) * 4;
        return `data:${type};base64,${'A'.repeat(Math.max(4, n))}`;
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  return { makeCanvas, canvases };
}

describe('logo compression (light canvas)', () => {
  it('2000x1000 -> proportional 256x128 transparent PNG', () => {
    const { makeCanvas, canvases } = fakeEnv(0.4);
    const out = compressLogoSource({}, 2000, 1000, { makeCanvas });
    expect(out.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrlBytes(out)).toBeLessThanOrEqual(LOGO_LIMITS.maxStoredBytes);
    const final = canvases.find((c) => c.calls.types.length);
    expect(final.calls.sizes[0]).toEqual([256, 128]);
  });

  it('sets explicit canvas sizes, high smoothing, never fills white (keeps transparency)', () => {
    const { makeCanvas, canvases } = fakeEnv();
    compressLogoSource({}, 3000, 3000, { makeCanvas });
    for (const c of canvases) {
      expect(c.sized).toBe(true);
      expect([c.width, c.height]).not.toEqual([300, 150]);
      expect(c.calls.cleared).toBeGreaterThan(0);
      for (const s of c.calls.smoothing) expect(s).toEqual([true, 'high']);
    }
  });

  it('halves in steps before the final draw', () => {
    const { makeCanvas, canvases } = fakeEnv();
    compressLogoSource({}, 2048, 2048, { makeCanvas });
    const widths = canvases.flatMap((c) => c.calls.draws.map((d) => d.w));
    expect(widths[0]).toBe(1024);
    expect(widths).toContain(256);
  });

  it('never upscales a small logo', () => {
    const { makeCanvas, canvases } = fakeEnv(0.1);
    compressLogoSource({}, 120, 60, { makeCanvas });
    const final = canvases.find((c) => c.calls.types.length);
    expect(final.calls.sizes[0]).toEqual([120, 60]);
  });

  it('falls back to WebP when PNG is heavy, and shrinks if still too big', () => {
    const { makeCanvas, canvases } = fakeEnv(1.2);
    const out = compressLogoSource({}, 1000, 1000, { makeCanvas });
    const types = canvases.flatMap((c) => c.calls.types);
    expect(types).toContain('image/webp');
    expect(dataUrlBytes(out)).toBeLessThanOrEqual(LOGO_LIMITS.maxStoredBytes);
  });

  it('compressLogo validates type (raster only) and size', async () => {
    const env = { makeCanvas: fakeEnv().makeCanvas, decode: async () => ({ source: {}, width: 800, height: 400, close() {} }) };
    await expect(compressLogo({ type: 'image/svg+xml', size: 100 }, env)).rejects.toMatchObject({ code: 'type' });
    await expect(compressLogo({ type: 'application/pdf', size: 100 }, env)).rejects.toMatchObject({ code: 'type' });
    await expect(compressLogo(null, env)).rejects.toMatchObject({ code: 'type' });
    await expect(compressLogo({ type: 'image/png', size: LOGO_LIMITS.maxInputBytes + 1 }, env)).rejects.toMatchObject({ code: 'size' });
    const ok = await compressLogo({ type: 'image/webp', size: 5000 }, env);
    expect(normalizeLogo(ok)).toBe(ok);
  });

  it('an undecodable image is a decode error', () => {
    expect(() => compressLogoSource({}, 0, 0, { makeCanvas: fakeEnv().makeCanvas })).toThrow();
  });
});

describe('logo validation', () => {
  it('accepts only small base64 raster images', () => {
    const good = `data:image/png;base64,${'A'.repeat(400)}`;
    expect(normalizeLogo(good)).toBe(good);
    expect(normalizeLogo('data:image/svg+xml;base64,AAAA')).toBe('');
    expect(normalizeLogo('https://evil.example/logo.png')).toBe('');
    expect(normalizeLogo('data:image/png;base64,<script>')).toBe('');
    expect(normalizeLogo(`data:image/png;base64,${'A'.repeat(200_000)}`)).toBe('');
    expect(normalizeLogo(null)).toBe('');
  });
});

describe('logo persistence in IndexedDB (base64)', () => {
  const LOGO = `data:image/png;base64,${'iVBORw0KGgo'.repeat(40)}AAAA`;

  it('saves, reloads after a "restart" and clears', async () => {
    const factory = new IDBFactory();
    const store = createLogoStore(idbLogoBackend(factory));
    expect(await store.load()).toBe('');
    await store.save(LOGO);
    expect(store.kind).toBe('indexeddb');
    const reloaded = createLogoStore(idbLogoBackend(factory));
    expect(await reloaded.load()).toBe(LOGO);
    await reloaded.clear();
    expect(await createLogoStore(idbLogoBackend(factory)).load()).toBe('');
  });

  it('refuses invalid logos and never returns tampered stored data', async () => {
    const factory = new IDBFactory();
    const store = createLogoStore(idbLogoBackend(factory));
    await expect(store.save('javascript:alert(1)')).rejects.toThrow();
    await idbLogoBackend(factory).set({ key: 'logo', dataUrl: 'data:text/html;base64,AAAA' });
    expect(await store.load()).toBe('');
  });

  it('memory fallback when IndexedDB fails', async () => {
    const broken = { kind: 'indexeddb', get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); }, clear: async () => {} };
    const store = createLogoStore(broken);
    await store.save(LOGO);
    expect(store.kind).toBe('memory');
    expect(await store.load()).toBe(LOGO);
    expect(await createLogoStore(memoryLogoBackend()).load()).toBe('');
  });
});
