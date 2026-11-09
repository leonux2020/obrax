// Prices read straight from the browser (BYOK) are GROUNDED: every request carries "tools": [{"google_search": {}}].
import { describe, it, expect, vi } from 'vitest';
import { buildPricesRequest, buildPricesPrompt, parseModelJson, PRICES_SCHEMA, SEARCH_TOOLS } from '../src/lib/geminiRequests.js';
import { InvoiceError, callGemini } from '../src/lib/gemini.js';
import { requestPriceBook } from '../src/lib/priceFeed.js';
import { CATALOG } from '../src/lib/catalog.js';
import { getRegion } from '../src/lib/regions.js';

const region = getRegion('CL');
const ref = (id) => CATALOG[id].usd * region.fx * region.priceFactor;
const text = (t) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const http = (status) => ({ ok: false, status, json: async () => ({ error: { message: 'x' } }), text: async () => 'x' });
const good = JSON.stringify({ materials: [{ id: 'cement_bag', price: ref('cement_bag') * 1.1 }], rent: [] });
const KEY = 'AIzaSyTEST_key_0123456789_abcdefghijk';
const prices = (fetchImpl) => requestPriceBook('CL', { fetchImpl, apiKey: KEY });
const sentBody = (f, i = 0) => JSON.parse(f.mock.calls[i][1].body);

describe('grounded price request', () => {
  it('the body ALWAYS includes "tools": [{"google_search": {}}] (grounded is the default)', () => {
    expect(SEARCH_TOOLS).toEqual([{ google_search: {} }]);
    for (const model of ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash']) {
      const body = buildPricesRequest({ regionCode: 'CL', model });
      expect(body.tools).toEqual([{ google_search: {} }]);
      expect(JSON.stringify(body)).toContain('"tools":[{"google_search":{}}]');
      expect(body.generationConfig.responseSchema).toBeUndefined();
      expect(body.systemInstruction.parts[0].text).toContain('Google Search');
      expect(body.systemInstruction.parts[0].text).toContain('Identifica el país (CL)');
    }
    expect(buildPricesPrompt('CL')).not.toContain('Use the Google Search tool'); // the plain prompt is unchanged
  });

  it('the browser sends the search tool to Gemini for kind "prices" and returns the validated book (the key goes in the URL, never in a header or the body)', async () => {
    const f = vi.fn(async () => text(good));
    const book = await prices(f);
    expect(Object.keys(book.materials)).toEqual(['cement_bag']);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sentBody(f).tools).toEqual([{ google_search: {} }]);
    expect(f.mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${KEY}`);
    expect(f.mock.calls[0][1].credentials).toBe('omit');
    expect(JSON.stringify(sentBody(f))).not.toContain(KEY);
  });

  it('a grounded answer with a sentence or markdown around the JSON is still read', async () => {
    expect(parseModelJson({ candidates: [{ content: { parts: [{ text: `Según Sodimac hoy:\n\`\`\`json\n${good}\n\`\`\`\nFuente: sodimac.cl` }] } }] }).materials).toHaveLength(1);
    expect(parseModelJson({ candidates: [{ content: { parts: [{ text: `Aquí está ${good} gracias` }] } }] }).materials).toHaveLength(1);
    expect(parseModelJson({ candidates: [{ content: { parts: [{ text: 'sin datos' }] } }] })).toBeNull();
    const f = vi.fn(async () => text(`Precios vigentes:\n${good}`));
    expect(Object.keys((await prices(f)).materials)).toEqual(['cement_bag']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('only when the grounded request gives nothing usable (tool refused / quota / unreadable) does ONE plain schema request follow', async () => {
    const f = vi.fn(async (_url, init) => (JSON.parse(init.body).tools ? http(400) : text(good)));
    const book = await prices(f);
    expect(Object.keys(book.materials)).toEqual(['cement_bag']);
    const bodies = f.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].tools).toEqual([{ google_search: {} }]); // always tried first
    expect(bodies.at(-1).tools).toBeUndefined();
    expect(bodies.at(-1).generationConfig.responseSchema).toEqual(JSON.parse(JSON.stringify(PRICES_SCHEMA)));
    expect(f.mock.calls.length).toBeLessThanOrEqual(1 + 2); // grounded once + the plain request (with its model fallback)

    const prose = vi.fn(async (_u, init) => (JSON.parse(init.body).tools ? text('No encontré precios') : text(good)));
    expect(Object.keys((await prices(prose)).materials)).toEqual(['cement_bag']);
    const down = vi.fn(async () => http(429));
    await expect(prices(down)).rejects.toMatchObject({ code: 'rate_limited' }); // both fail: the client keeps its saved values
  });

  it('a key Google rejects ends the price request at once (no second request can help) and no key sends nothing', async () => {
    const denied = vi.fn(async () => http(403));
    await expect(prices(denied)).rejects.toMatchObject({ code: 'bad_key' });
    expect(denied).toHaveBeenCalledTimes(1);
    const f = vi.fn(async () => text(good));
    await expect(requestPriceBook('CL', { fetchImpl: f, apiKey: '' })).rejects.toBeInstanceOf(InvoiceError);
    expect(f).not.toHaveBeenCalled();
  });

  it('invoices and receipts never get the search tool (they read an image)', async () => {
    const f = vi.fn(async () => text(JSON.stringify({ isInvoice: false, items: [] })));
    await callGemini({ kind: 'invoice', dataUrl: `data:image/png;base64,iVBORw0KGgo${'A'.repeat(200)}`, fetchImpl: f, apiKey: KEY });
    expect(f).toHaveBeenCalled();
    expect(sentBody(f).tools).toBeUndefined();
  });
});
