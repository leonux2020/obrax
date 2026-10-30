// Regression: the serverless function (api/extract-invoice.js) crashed in production with FUNCTION_INVOCATION_FAILED because a
// module of its import chain loaded a .json file without an import attribute (fine for Vite / Vitest, fatal for native Node ESM).
// Vitest hides that kind of bug, so these tests load the function in a REAL, plain Node process (no Vite transform).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toNodeHandler } from '../server/node.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '' }, timeout: 60_000 });

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(js|jsx|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('serverless function loads in native Node ESM', () => {
  it('imports api/extract-invoice.js with plain Node and answers 503 not_configured without a key', () => {
    const out = node(`
      const { default: fn } = await import('./api/extract-invoice.js');
      const headers = { 'content-type': 'application/json' };
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      const req = { method: 'POST', headers, socket: {}, body: JSON.stringify({ image: 'x', kind: 'receipt' }) };
      await fn(req, res);
      console.log(JSON.stringify({ status: res.statusCode, body: JSON.parse(res.body) }));
    `);
    expect(JSON.parse(out.trim().split('\n').pop())).toEqual({ status: 503, body: { ok: false, error: 'not_configured' } });
  });

  it('the server import chain (geminiProxy, plugins/ai-proxy) has no JSON import without an attribute', () => {
    const offenders = [];
    for (const f of [...walk(path.join(root, 'src/lib')), ...walk(path.join(root, 'server')), ...walk(path.join(root, 'api')), ...walk(path.join(root, 'src/data'))]) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^\s*import\s[^;\n]*?from\s+['"]([^'"]+\.json)['"]\s*(;|with\b|assert\b)?/gm)) if (!/with\s*\{/.test(m[0])) offenders.push(`${path.relative(root, f)} -> ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the base catalog is a JS module with the same shape the app reads', async () => {
    const { default: data } = await import('../src/data/baseCatalog.js');
    expect(data.version).toBeGreaterThan(0);
    expect(Object.keys(data.items).length).toBeGreaterThan(20);
    expect(fs.existsSync(path.join(root, 'src/data/baseCatalog.json'))).toBe(false);
  });
});

describe('unexpected server errors: logged always, returned only in development', () => {
  const mockReq = () => ({ method: 'POST', headers: {}, socket: {}, body: '{}' });
  const mockRes = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
  const boom = async () => {
    throw new Error('kaboom SECRET-KEY-123 in handler');
  };

  it('production (default): generic body, but the real stack goes to the server log (key scrubbed)', async () => {
    const lines = [];
    const res = mockRes();
    await toNodeHandler(boom, { secrets: ['SECRET-KEY-123'], log: (l) => lines.push(l) })(mockReq(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'upstream' });
    expect(lines.join('\n')).toMatch(/kaboom \*\*\* in handler/);
    expect(lines.join('\n')).not.toContain('SECRET-KEY-123');
  });

  it('development (devErrors): the real error and stack travel in `detail`, still without the key', async () => {
    const res = mockRes();
    await toNodeHandler(boom, { devErrors: true, secrets: ['SECRET-KEY-123'], log: () => {} })(mockReq(), res);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ ok: false, error: 'upstream' });
    expect(body.detail).toMatch(/kaboom \*\*\* in handler/);
    expect(body.detail).toMatch(/at /); // stack frames
    expect(body.detail).not.toContain('SECRET-KEY-123');
  });
});
