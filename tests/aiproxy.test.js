import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  createInvoiceHandler,
  createKeyedLimiter,
  buildGeminiRequest,
  buildPrompt,
  parseModelJson,
  thinkingFor,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  GEMINI_BASE,
  MAX_BODY_BYTES,
  KINDS,
  buildReceiptPrompt,
  RECEIPT_DOC_SCHEMA,
  RECEIPT_SCHEMA,
} from '../server/geminiProxy.js';
import { readGeminiConfig } from '../server/env.js';
import { toNodeHandler } from '../server/node.js';
import aiProxy, { AI_ROUTE } from '../plugins/ai-proxy.js';
import { CATALOG } from '../src/lib/catalog.js';
import { CSP_DIRECTIVES } from '../security/policy.js';

const KEY = 'AIzaSy-TEST-KEY-do-not-leak-0123456789';
const IMG = `data:image/jpeg;base64,/9j/${'A'.repeat(200)}`;
const PNG = `data:image/png;base64,iVBORw0KGgo${'A'.repeat(200)}`;
const root = process.cwd();

const modelAnswer = (obj) => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });
const invoice = (over = {}) => ({
  isInvoice: true,
  currency: 'CLP',
  taxIncluded: false,
  supplier: 'Ferretería Sur',
  invoiceDate: '2026-10-20',
  items: [
    { description: 'Cemento 25 kg', materialId: 'cement_bag', quantity: 10, unit: 'saco', unitPriceText: '4.990', unitPrice: 4.99, lineTotalText: '49.900', priceBasis: 'sale_unit' },
    { description: 'Flete', materialId: null, quantity: 1, unit: 'un', unitPriceText: '12.000', unitPrice: 12, priceBasis: 'sale_unit' },
  ],
  ...over,
});
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const okFetch = (obj = invoice()) => vi.fn(async () => reply(200, modelAnswer(obj)));
const request = (over = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' },
  ip: '10.0.0.1',
  bodyText: JSON.stringify({ image: IMG, currency: 'CLP', lang: 'es' }),
  ...over,
});
const make = (over = {}) => createInvoiceHandler({ apiKey: KEY, fetchImpl: okFetch(), ...over });

describe('proxy: request validation (nothing reaches Google unless it is a clean image upload)', () => {
  it('only POST is accepted', async () => {
    const f = okFetch();
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) expect((await make({ fetchImpl: f })(request({ method }))).status, method).toBe(405);
    expect(f).not.toHaveBeenCalled();
  });

  it('without GEMINI_API_KEY it answers 503 not_configured and never calls Google', async () => {
    const f = okFetch();
    const res = await make({ apiKey: '', fetchImpl: f })(request());
    expect(res).toEqual({ status: 503, body: { ok: false, error: 'not_configured' } });
    expect(f).not.toHaveBeenCalled();
  });

  it('same-origin only: foreign Origin, cross-site fetch metadata and a bad Origin are rejected', async () => {
    const f = okFetch();
    const h = make({ fetchImpl: f });
    const base = request().headers;
    expect((await h(request({ headers: { ...base, origin: 'https://evil.example' } }))).status).toBe(403);
    expect((await h(request({ headers: { ...base, 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
    expect((await h(request({ headers: { ...base, origin: 'not a url' } }))).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
    expect((await h(request({ headers: { ...base, 'sec-fetch-site': 'same-origin' } }))).status).toBe(200);
    const { origin, ...noOrigin } = base; // same-origin GET-less tools (curl, server-side) carry no Origin
    void origin;
    expect((await h(request({ headers: noOrigin }))).status).toBe(200);
  });

  it('JSON only, size capped, and the image must be a real jpeg/png/webp data URL', async () => {
    const f = okFetch();
    const h = make({ fetchImpl: f });
    const json = request().headers;
    expect((await h(request({ headers: { ...json, 'content-type': 'text/plain' } }))).status).toBe(415);
    expect((await h(request({ bodyText: 'x'.repeat(MAX_BODY_BYTES + 1) }))).status).toBe(413);
    expect((await h(request({ bodyText: '{nope' }))).body.error).toBe('bad_image');
    const bad = [
      {},
      { image: 42 },
      { image: 'https://example.com/a.jpg' },
      { image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { image: 'data:text/html;base64,PGgxPmhpPC9oMT4=' },
      { image: `data:image/png;base64,/9j/${'A'.repeat(200)}` }, // declared png, jpeg bytes
      { image: 'data:image/jpeg;base64,/9j/AAAA' }, // too short to be an image
      { image: `data:image/jpeg;base64,/9j/${'A'.repeat(200)}!!` },
    ];
    for (const b of bad) expect((await h(request({ bodyText: JSON.stringify(b) }))).body, JSON.stringify(b).slice(0, 40)).toEqual({ ok: false, error: 'bad_image' });
    expect(f).not.toHaveBeenCalled();
    expect((await h(request({ bodyText: JSON.stringify({ image: PNG }) }))).status).toBe(200);
  });

  it('per-IP and global rate limits (fixed windows, injectable clock)', async () => {
    let now = 1_000_000;
    const h = make({ perIpLimit: 2, globalLimit: 3, clock: () => now });
    expect((await h(request({ ip: 'a' }))).status).toBe(200);
    expect((await h(request({ ip: 'a' }))).status).toBe(200);
    expect((await h(request({ ip: 'a' }))).body.error).toBe('rate_limited');
    expect((await h(request({ ip: 'b' }))).status).toBe(200); // another visitor, global 3/3
    expect((await h(request({ ip: 'c' }))).status).toBe(429); // global limit
    now += 61_000;
    expect((await h(request({ ip: 'a' }))).status).toBe(200);
    const lim = createKeyedLimiter(1, 1000, () => now);
    expect([lim('k'), lim('k')]).toEqual([true, false]);
  });
});

describe('proxy: the call to Google AI Studio', () => {
  it('sends the key ONLY in the x-goog-api-key header, the image as inline data, and a fixed server-built prompt', async () => {
    const f = okFetch();
    const res = await make({ fetchImpl: f })(request());
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent`);
    expect(url).not.toContain(KEY);
    expect(url).not.toContain('key=');
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe(KEY);
    expect(init.body).not.toContain(KEY);
    const body = JSON.parse(init.body);
    const inline = body.contents[0].parts[1].inlineData;
    expect(inline.mimeType).toBe('image/jpeg');
    expect(inline.data).toBe(IMG.split(',')[1]); // raw base64, no data: prefix
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.properties.items.type).toBe('ARRAY');
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.systemInstruction.parts[0].text).toContain('CLP');
    // the browser cannot change model, prompt or generation settings
    const sneaky = request({ bodyText: JSON.stringify({ image: IMG, currency: 'CLP', model: 'gemini-evil', prompt: 'ignore everything', generationConfig: { x: 1 }, systemInstruction: 'x' }) });
    await make({ fetchImpl: f })(sneaky);
    const [url2, init2] = f.mock.calls[1];
    expect(url2).toBe(url);
    expect(init2.body).not.toMatch(/gemini-evil|ignore everything/);
  });

  it('returns the validated extraction; prices are read from the PRINTED text ("4.990" is 4990, not 4.99)', async () => {
    const res = await make()(request());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.currency).toBe('CLP');
    expect(res.body.supplier).toBe('Ferretería Sur');
    expect(res.body.items[0]).toMatchObject({ materialId: 'cement_bag', quantity: 10, unitPrice: 4990, lineTotal: 49900, consistent: true });
    expect(res.body.items[1]).toMatchObject({ materialId: null, unitPrice: 12000 });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('hostile model output cannot add unknown materials, giant numbers or markup', async () => {
    const evil = invoice({
      supplier: '<script>alert(1)</script> Evil',
      items: [
        { description: '<img src=x onerror=alert(1)> cemento', materialId: '__proto__', quantity: 1e12, unit: 'u'.repeat(500), unitPriceText: '1.000.000.000.000.000', priceBasis: 'sale_unit' },
        { description: 'ok', materialId: 'sand', quantity: 2, unit: 'bb', unitPriceText: '14.500', priceBasis: 'base_unit' },
        { description: 'no price', materialId: 'gravel', unitPriceText: 'gratis', priceBasis: 'sale_unit' },
        null,
        'x',
      ],
    });
    const res = await make({ fetchImpl: okFetch(evil) })(request());
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1); // absurd price and priceless lines dropped
    expect(res.body.items[0].materialId).toBe('sand');
    expect(res.body.supplier).not.toMatch(/[<>]/);
    const many = invoice({ items: Array.from({ length: 500 }, (_, i) => ({ description: `x${i}`, materialId: 'sand', unitPriceText: '1.500', priceBasis: 'sale_unit' })) });
    expect((await make({ fetchImpl: okFetch(many) })(request())).body.items.length).toBeLessThanOrEqual(60);
  });

  it('unusable answers map to fixed error codes', async () => {
    const run = async (fetchImpl) => (await make({ fetchImpl })(request())).body.error;
    expect(await run(okFetch('this is not json'))).toBe('unreadable');
    expect(await run(okFetch('```json\n{"isInvoice":false,"items":[]}\n```'))).toBe('not_invoice');
    expect(await run(okFetch(invoice({ items: [] })))).toBe('unreadable');
    expect(await run(vi.fn(async () => reply(200, { promptFeedback: { blockReason: 'SAFETY' } })))).toBe('unreadable');
    expect(parseModelJson(modelAnswer('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(parseModelJson({})).toBeNull();
  });

  it('retries the fallback model on overload / retired models, but not on client errors', async () => {
    const seen = [];
    const flaky = vi.fn(async (url) => {
      seen.push(url.split('/models/')[1].split(':')[0]);
      return seen.length === 1 ? reply(503, { error: { message: `overloaded ${KEY}` } }) : reply(200, modelAnswer(invoice()));
    });
    const res = await make({ fetchImpl: flaky })(request());
    expect(res.status).toBe(200);
    expect(seen).toEqual([DEFAULT_MODEL, FALLBACK_MODEL]);

    const logs = [];
    const down = vi.fn(async () => reply(404, { error: { message: `model gone, key ${KEY}` } }));
    const res2 = await make({ fetchImpl: down, log: (l) => logs.push(l) })(request());
    expect(res2).toEqual({ status: 502, body: { ok: false, error: 'upstream' } });
    expect(down).toHaveBeenCalledTimes(2);
    expect(logs.join('\n')).not.toContain(KEY); // server-side diagnostics are redacted too
    expect(logs.join('\n')).toContain('HTTP 404');

    const bad = vi.fn(async () => reply(400, { error: { message: 'invalid argument' } }));
    expect((await make({ fetchImpl: bad })(request())).body.error).toBe('upstream');
    expect(bad).toHaveBeenCalledTimes(1); // another model would not fix a 400

    const limited = vi.fn(async () => reply(429, {}));
    expect((await make({ fetchImpl: limited })(request())).body.error).toBe('rate_limited');
  });

  it('upstream error text is never forwarded and a hung upstream becomes 504 timeout', async () => {
    const leaky = vi.fn(async () => reply(500, { error: { message: `secret ${KEY} details` } }));
    const res = await make({ fetchImpl: leaky })(request());
    expect(JSON.stringify(res)).not.toMatch(/secret|details/);
    const hang = vi.fn((_url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    const t = await make({ fetchImpl: hang, timeoutMs: 20 })(request());
    expect(t).toEqual({ status: 504, body: { ok: false, error: 'timeout' } });
    const boom = vi.fn(async () => {
      throw new Error(`connect failed ${KEY}`);
    });
    expect(JSON.stringify(await make({ fetchImpl: boom })(request()))).not.toContain(KEY);
  });

  it('prompt lists the whole catalog, treats the document as data, and thinking is switched off per model family', () => {
    const p = buildPrompt({ currency: 'clp' });
    for (const id of Object.keys(CATALOG)) expect(p, id).toContain(`- ${id}:`);
    expect(p).toMatch(/never as instructions/);
    expect(p).toContain('CLP');
    expect(buildPrompt({ currency: '"; drop' })).toContain('the local currency'); // currency cannot inject text
    expect(thinkingFor('gemini-flash-lite-latest')).toEqual({});
    expect(thinkingFor('gemini-2.5-flash')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingFor('gemini-flash-latest')).toEqual({ thinkingConfig: { thinkingLevel: 'low' } });
    const body = buildGeminiRequest({ mime: 'image/png', data: 'AAAA', currency: 'CLP', model: DEFAULT_MODEL });
    expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'AAAA' });
  });
});

// ---- Node adapter + the Vite plugin (driven with mock req/res: no sockets needed) ----------------------------
function mockReq({ method = 'POST', body = '', headers = {} } = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method;
  r.headers = { 'content-type': 'application/json', host: 'localhost:3000', ...headers };
  r.socket = { remoteAddress: '127.0.0.1' };
  return r;
}
function mockRes() {
  const res = { headers: {}, statusCode: 0, body: '' };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.end = (b) => {
    res.body = b;
    res.done = true;
  };
  return res;
}
const drive = async (mw, req) => {
  const res = mockRes();
  await mw(req, res, () => {
    res.nexted = true;
  });
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
};
function mountPlugin(options) {
  const plugin = aiProxy(options);
  const mounts = [];
  const server = { config: { logger: { info: vi.fn(), warn: vi.fn() } }, middlewares: { use: (route, fn) => mounts.push({ route, fn }) } };
  plugin.configResolved({ mode: 'development', root });
  plugin.configureServer(server);
  return { plugin, server, mount: mounts[0] };
}

describe('Vite plugin + Node adapter: /api/extract-invoice on localhost:3000', () => {
  it('mounts the route, reads the key on the server only, and answers JSON with security headers', async () => {
    const f = okFetch();
    const { server, mount } = mountPlugin({ env: { GEMINI_API_KEY: KEY }, fetchImpl: f });
    expect(mount.route).toBe(AI_ROUTE);
    expect(server.config.logger.info.mock.calls.join()).toContain('ready');
    expect(server.config.logger.info.mock.calls.join()).not.toContain(KEY);
    const r = await drive(mount.fn, mockReq({ body: JSON.stringify({ image: IMG, currency: 'CLP' }), headers: { origin: 'http://localhost:3000' } }));
    expect(r.statusCode).toBe(200);
    expect(r.json.items[0].materialId).toBe('cement_bag');
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body).not.toContain(KEY);
    expect(f.mock.calls[0][1].headers['x-goog-api-key']).toBe(KEY);
  });

  it('missing key: the dev server says so and the route answers 503; GET gets 405 with Allow', async () => {
    const f = okFetch();
    const { server, mount } = mountPlugin({ env: {}, fetchImpl: f });
    expect(server.config.logger.info.mock.calls.join()).toMatch(/missing/i);
    expect((await drive(mount.fn, mockReq({ body: JSON.stringify({ image: IMG }) }))).statusCode).toBe(503);
    const get = await drive(mount.fn, mockReq({ method: 'GET' }));
    expect(get.statusCode).toBe(405);
    expect(get.headers.allow).toBe('POST');
    expect(f).not.toHaveBeenCalled();
  });

  it('cuts off an oversized upload while reading it, and never leaks an exception', async () => {
    const f = okFetch();
    const { mount } = mountPlugin({ env: { GEMINI_API_KEY: KEY }, fetchImpl: f });
    const big = await drive(mount.fn, mockReq({ body: 'x'.repeat(MAX_BODY_BYTES + 10) }));
    expect(big.statusCode).toBe(413);
    expect(f).not.toHaveBeenCalled();
    const broken = toNodeHandler(async () => {
      throw new Error(`oops ${KEY}`);
    });
    const r = await drive(broken, mockReq({ body: '{}' }));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toMatch(/oops|AIza/);
  });

  it('serverless entry (api/) uses the same handler and GEMINI_API_KEY from the host environment', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { default: fn } = await import('../api/extract-invoice.js');
    const res = mockRes();
    await fn(mockReq({ body: JSON.stringify({ image: IMG }) }), res);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe('not_configured');
    vi.unstubAllEnvs();
    expect(readGeminiConfig({ GEMINI_API_KEY: '  k  ', GEMINI_MODEL: ' gemini-x ' })).toEqual({ apiKey: 'k', model: 'gemini-x' });
    expect(readGeminiConfig({})).toEqual({ apiKey: '' });
  });
});

// ---- the key must never reach the browser ----------------------------------------------------------------------
const walk = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];
const rel = (f) => path.relative(root, f).split(path.sep).join('/');

describe('GEMINI_API_KEY stays on the server', () => {
  it('only server code, the plugin, the serverless entry, docs and tests mention it', () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'public')), path.join(root, 'index.html'), path.join(root, 'vite.config.js')].filter((f) => fs.existsSync(f));
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), rel(f)).not.toMatch(/GEMINI_API_KEY|x-goog-api-key|generativelanguage\.googleapis/);
    const owners = ['server/env.js', 'server/geminiProxy.js', 'plugins/ai-proxy.js', 'api/extract-invoice.js'];
    for (const o of owners) expect(fs.existsSync(path.join(root, o)), o).toBe(true);
    // the ONLY file that reads the variable from an environment object
    const readers = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'plugins')), ...walk(path.join(root, 'api'))].filter((f) => /\benv\.GEMINI_API_KEY|env\[['"]GEMINI/.test(fs.readFileSync(f, 'utf8')));
    expect(readers.map(rel)).toEqual(['server/env.js']);
  });

  it('is not VITE_-prefixed, not defined into the bundle, and .env.local is git-ignored', () => {
    const cfg = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
    expect(cfg).not.toMatch(/define\s*:|envPrefix/);
    const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(example).not.toMatch(/VITE_GEMINI/i);
    expect(example).toMatch(/GEMINI_API_KEY=\s*$/m); // placeholder only, no real value
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toMatch(/^\.env\.local$/m);
    const sources = Object.values(CSP_DIRECTIVES).flat();
    expect(sources.join(' ')).not.toMatch(/generativelanguage/); // the browser never talks to Google AI
    // the only googleapis.com sources are the Drive v3 REST paths used by the backup (no wildcard, no other API)
    expect(sources.filter((x) => x.includes('googleapis.com')).sort()).toEqual(['https://www.googleapis.com/drive/', 'https://www.googleapis.com/upload/drive/']);
    expect(CSP_DIRECTIVES['connect-src']).toContain("'self'"); // ...only to our own /api route
  });

  it('a production build (if present) contains neither the key value nor the development-only PRO switch', () => {
    const dist = walk(path.join(root, 'dist'));
    if (!dist.length) return;
    const envFile = path.join(root, '.env.local');
    const match = fs.existsSync(envFile) ? /^GEMINI_API_KEY=(.+)$/m.exec(fs.readFileSync(envFile, 'utf8')) : null;
    const key = match?.[1]?.trim();
    for (const f of dist.filter((x) => /\.(js|html|json|css|map)$/.test(x))) {
      const text = fs.readFileSync(f, 'utf8');
      if (key) expect(text.includes(key), rel(f)).toBe(false);
      expect(text, rel(f)).not.toMatch(/GEMINI_API_KEY|x-goog-api-key|pro-dev-activate/);
    }
  });
});

describe('proxy: "Escanear Boleta" ({kind:"receipt"}) is a second FIXED prompt behind the same protections', () => {
  const receipt = (over = {}) => ({
    isReceipt: true,
    currency: 'CLP',
    supplier: 'Arriendos Sur',
    receiptDate: '2026-10-20',
    items: [
      { description: 'Taladro percutor', quantity: 1, amountText: '12.000', amount: 12, category: 'tool_rental', returnDate: '2026-10-22' },
      { description: 'Cemento', quantity: 2, amountText: '9.980', amount: 9.98, category: 'material', returnDate: '2026-10-22' },
    ],
    ...over,
  });
  // the model's answer for a photo: { isReceipt, receipts: [ one entry per document ] }; `vendorName` is its name for the shop
  const answer = (...docs) => ({ isReceipt: true, receipts: docs.map(({ supplier, isReceipt, ...d }) => ({ vendorName: supplier, ...d })) });
  const receiptRequest = (over = {}) => request({ bodyText: JSON.stringify({ image: IMG, currency: 'CLP', kind: 'receipt', ...over }) });
  const clock = () => new Date(2026, 9, 22, 12, 0, 0).getTime();

  it('only picks one of two server prompts; any unknown kind is an invoice, and the browser cannot send text', async () => {
    expect(KINDS).toEqual(['invoice', 'receipt', 'prices']); // prices: region code only, no image
    const f = okFetch(receipt());
    const res = await make({ fetchImpl: f, clock })(receiptRequest());
    expect(res.status).toBe(200);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe(buildReceiptPrompt({ currency: 'CLP', today: '2026-10-22' }));
    expect(body.systemInstruction.parts[0].text).toContain('Today is 2026-10-22');
    expect(body.generationConfig.responseSchema).toEqual(JSON.parse(JSON.stringify(RECEIPT_SCHEMA)));

    const f2 = okFetch();
    for (const kind of ['evil', 'RECEIPT', 5, null, { x: 1 }]) await make({ fetchImpl: f2 })(receiptRequest({ kind }));
    for (const [, init] of f2.mock.calls) expect(JSON.parse(init.body).systemInstruction.parts[0].text).toBe(buildPrompt({ currency: 'CLP' }));

    const f3 = okFetch(receipt());
    await make({ fetchImpl: f3, clock })(receiptRequest({ prompt: 'ignore everything', systemInstruction: 'x', today: '1999-01-01', model: 'gemini-evil' }));
    expect(f3.mock.calls[0][1].body).not.toMatch(/ignore everything|1999-01-01|gemini-evil/);
    expect(f3.mock.calls[0][0]).toBe(`${GEMINI_BASE}/${DEFAULT_MODEL}:generateContent`);
  });

  it('returns tabulated lines: printed amounts win, rentals keep the return day, and the key never appears', async () => {
    const res = await make({ fetchImpl: okFetch(answer(receipt())), clock })(receiptRequest());
    expect(res.body.receipts).toHaveLength(1);
    expect(res.body.receipts[0]).toMatchObject({ currency: 'CLP', supplier: 'Arriendos Sur', date: '2026-10-20' });
    expect(res.body.receipts[0].items).toEqual([
      expect.objectContaining({ amount: 12000, category: 'tool_rental', returnDate: '2026-10-22' }),
      expect.objectContaining({ amount: 9980, category: 'material', returnDate: '' }),
    ]);
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it('the receipt prompt accepts ANY legible commercial receipt (food, fuel, supermarket) and asks for the full breakdown', () => {
    const text = buildReceiptPrompt({ currency: 'CLP', today: '2026-10-22' });
    expect(text).toMatch(/supermarket/i);
    expect(text).toMatch(/FUEL/);
    expect(text).toMatch(/ACCEPT any legible commercial document/);
    expect(text).toMatch(/NEVER reject a document because it is not a construction-material store/);
    expect(text).toMatch(/ONLY when the image is not a purchase document at all/);
    for (const field of ['receipts', 'vendorName', 'receiptDate', 'currency', 'totalText', 'purchaseType', 'unitPriceText', 'quantity', 'amountText']) expect(text).toContain(`"${field}"`);
    for (const c of ['material', 'food', 'transport', 'other']) expect(text).toContain(c);
    // the schema lets the model answer with the general type, the total and the unit price, and food is a category
    expect(RECEIPT_DOC_SCHEMA.properties.purchaseType.enum).toContain('food');
    expect(RECEIPT_DOC_SCHEMA.properties.items.items.properties.category.enum).toContain('food');
    expect(Object.keys(RECEIPT_DOC_SCHEMA.properties)).toEqual(expect.arrayContaining(['totalText', 'total', 'purchaseType']));
    expect(Object.keys(RECEIPT_DOC_SCHEMA.properties.items.items.properties)).toEqual(expect.arrayContaining(['unitPriceText', 'unitPrice']));
  });

  it('the receipt prompt and schema ask for the fiscal metadata (null when the paper does not show it)', () => {
    const text = buildReceiptPrompt({ currency: 'CLP' });
    for (const f of ['vendorTaxId', 'documentType', 'documentNumber', 'paymentMethod', 'netAmount', 'taxAmount']) expect(text).toContain(`"${f}"`);
    expect(text).toMatch(/use null for every field that does not appear/);
    expect(text).toMatch(/RUT.*NIT.*Partita IVA/s);
    const props = RECEIPT_DOC_SCHEMA.properties;
    for (const f of ['vendorTaxId', 'documentType', 'documentNumber', 'paymentMethod', 'netAmount', 'taxAmount', 'netAmountText', 'taxAmountText']) expect(props[f].nullable, f).toBe(true);
    expect(props.documentType.enum).toEqual(['invoice', 'receipt', 'ticket', 'other']);
    expect(props.paymentMethod.enum).toEqual(['cash', 'card', 'transfer', 'other']);
    expect(RECEIPT_DOC_SCHEMA.required).toEqual(['vendorName', 'items']); // the fiscal fields never make a receipt fail
  });

  it('fiscal fields travel through the proxy, cleaned', async () => {
    const res = await make({ fetchImpl: okFetch(answer(receipt({ vendorTaxId: '76.123.456-7', documentType: 'receipt', documentNumber: '000987', paymentMethod: 'cash', netAmount: 8403.36, taxAmount: 1596.64, totalText: '10.000' }))), clock })(receiptRequest());
    expect(res.body.receipts[0]).toMatchObject({ vendorTaxId: '76.123.456-7', documentType: 'receipt', documentNumber: '000987', paymentMethod: 'cash', netAmount: 8403.36, taxAmount: 1596.64 });
    const bare = await make({ fetchImpl: okFetch(answer(receipt({ vendorTaxId: null, documentType: null, paymentMethod: null }))), clock })(receiptRequest());
    expect(bare.body.receipts[0]).toMatchObject({ vendorTaxId: null, documentType: null, documentNumber: null, paymentMethod: null, netAmount: null, taxAmount: null });
  });

  it('a supermarket receipt goes through end to end with its food lines and general type', async () => {
    const res = await make({
      fetchImpl: okFetch(answer(receipt({ supplier: 'Jumbo', purchaseType: 'food', totalText: '12.500', items: [{ description: 'Pan', quantity: 5, unitPriceText: '1.000', amountText: '5.000', category: 'food' }, { description: 'Bencina', amountText: '7.500', category: 'transport' }] }))),
      clock,
    })(receiptRequest());
    expect(res.status).toBe(200);
    expect(res.body.receipts[0]).toMatchObject({ supplier: 'Jumbo', purchaseType: 'food', total: 12500 });
    expect(res.body.receipts[0].items.map((i) => i.category)).toEqual(['food', 'transport']);
    expect(res.body.receipts[0].items[0]).toMatchObject({ quantity: 5, unitPrice: 1000, amount: 5000 });
  });

  it('BATCH MODE: the prompt says one photo may hold several receipts, each independent, and the schema returns a `receipts` array', () => {
    const text = buildReceiptPrompt({ currency: 'CLP' });
    expect(text).toMatch(/ONE OR SEVERAL distinct receipts, invoices or tickets/);
    expect(text).toMatch(/EVERY separate document/);
    expect(text).toMatch(/"receipts" array/);
    expect(text).toMatch(/NEVER merge two documents/);
    expect(text).toMatch(/OWN vendorName/);
    expect(RECEIPT_SCHEMA.properties.receipts.type).toBe('ARRAY');
    expect(RECEIPT_SCHEMA.properties.receipts.items).toBe(RECEIPT_DOC_SCHEMA);
    expect(RECEIPT_SCHEMA.required).toEqual(['isReceipt', 'receipts']);
    expect(RECEIPT_DOC_SCHEMA.properties).toHaveProperty('vendorName');
  });

  it('a photo with THREE receipts returns three independent records, each with its own fiscal data and lines', async () => {
    const photo = answer(
      receipt({ supplier: 'Sodimac', vendorTaxId: '96.792.430-K', documentType: 'invoice', documentNumber: '1001', paymentMethod: 'card', totalText: '11.900', netAmountText: '10.000', taxAmountText: '1.900', items: [{ description: 'Cemento', amountText: '11.900', category: 'material' }] }),
      receipt({ supplier: 'Copec', vendorTaxId: '99.520.000-7', documentType: 'ticket', documentNumber: '77', paymentMethod: 'cash', purchaseType: 'transport', items: [{ description: 'Diésel', amountText: '30.000', category: 'transport' }] }),
      receipt({ supplier: 'Jumbo', purchaseType: 'food', items: [{ description: 'Almuerzo cuadrilla', amountText: '18.500', category: 'food' }] })
    );
    const f = okFetch(photo);
    const res = await make({ fetchImpl: f, clock })(receiptRequest());
    expect(res.status).toBe(200);
    expect(res.body.receipts.map((r) => r.supplier)).toEqual(['Sodimac', 'Copec', 'Jumbo']);
    expect(res.body.receipts[0]).toMatchObject({ vendorTaxId: '96.792.430-K', documentType: 'invoice', documentNumber: '1001', paymentMethod: 'card', netAmount: 10000, taxAmount: 1900 });
    expect(res.body.receipts[1]).toMatchObject({ vendorTaxId: '99.520.000-7', documentType: 'ticket', paymentMethod: 'cash', netAmount: null, taxAmount: null });
    expect(res.body.receipts[2]).toMatchObject({ vendorTaxId: null, documentNumber: null }); // nothing leaks from one document to the next
    expect(res.body.receipts.map((r) => r.items.map((i) => i.amount))).toEqual([[11900], [30000], [18500]]);
    // one request, one prompt, a bigger answer budget for the batch
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body).generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(16384);
  });

  it('in a batch, a document without readable lines is dropped but the rest are kept; a photo with no receipt at all is not_invoice', async () => {
    const mixed = { isReceipt: true, receipts: [{ vendorName: 'Vacío', items: [] }, { vendorName: 'Easy', items: [{ description: 'Taladro', amountText: '25.000', category: 'tool_rental' }] }] };
    const res = await make({ fetchImpl: okFetch(mixed), clock })(receiptRequest());
    expect(res.body.receipts.map((r) => r.supplier)).toEqual(['Easy']);
    expect((await make({ fetchImpl: okFetch({ isReceipt: false, receipts: [] }), clock })(receiptRequest())).body).toEqual({ ok: false, error: 'not_invoice' });
    expect((await make({ fetchImpl: okFetch({ isReceipt: true, receipts: [{ vendorName: 'X', items: [] }] }), clock })(receiptRequest())).body).toEqual({ ok: false, error: 'unreadable' });
    const many = { isReceipt: true, receipts: Array.from({ length: 30 }, (_, i) => ({ vendorName: `T${i}`, items: [{ description: 'x', amountText: '1', category: 'other' }] })) };
    expect((await make({ fetchImpl: okFetch(many), clock })(receiptRequest())).body.receipts).toHaveLength(10); // bounded
  });

  it('hostile output is neutralised and non-receipts / empty readings map to fixed error codes', async () => {
    const evil = receipt({ supplier: '<script>x</script>', items: [{ description: '<img onerror=1>', amountText: '1', category: 'drugs' }, { description: 'huge', amountText: '9'.repeat(40), category: 'material' }] });
    const res = await make({ fetchImpl: okFetch(answer(evil)), clock })(receiptRequest());
    expect(JSON.stringify(res.body)).not.toMatch(/[<>]/);
    expect(res.body.receipts[0].items.every((i) => ['material', 'other'].includes(i.category))).toBe(true);
    expect((await make({ fetchImpl: okFetch(receipt({ isReceipt: false })) })(receiptRequest())).body).toEqual({ ok: false, error: 'not_invoice' });
    expect((await make({ fetchImpl: okFetch(receipt({ items: [] })) })(receiptRequest())).body).toEqual({ ok: false, error: 'unreadable' });
  });

  it('every existing protection still applies to receipts (method, origin, size, image bytes, rate limit, no key)', async () => {
    const f = okFetch(receipt());
    const h = make({ fetchImpl: f, clock, perIpLimit: 2 });
    expect((await h({ ...receiptRequest(), method: 'GET' })).status).toBe(405);
    expect((await h({ ...receiptRequest(), headers: { ...receiptRequest().headers, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await h(receiptRequest({ image: 'data:image/jpeg;base64,AAAA' }))).status).toBeGreaterThanOrEqual(400);
    expect(f).not.toHaveBeenCalled();
    expect((await make({ apiKey: '', fetchImpl: f })(receiptRequest())).body).toEqual({ ok: false, error: 'not_configured' });
    expect((await h(receiptRequest())).status).toBe(200);
    expect((await h(receiptRequest())).status).toBe(200);
    expect((await h(receiptRequest())).status).toBe(429);
    const [, init] = f.mock.calls[0];
    expect(init.headers['x-goog-api-key']).toBe(KEY);
    expect(init.body).not.toContain(KEY);
  });

  it('the receipt client goes through the same endpoint and ships no server secret', () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/receipt.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/lib/invoice.js'), 'utf8');
    expect(src).toContain('/api/extract-invoice');
    expect(src).not.toMatch(/GEMINI_|x-goog-api-key|generativelanguage/);
  });
});
