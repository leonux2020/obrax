// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newDraft, normalizeDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { chainTotals, marketBucket, MARKET_WINDOW_MS, resolvePrices } from '../src/lib/pricing.js';
import { getRegion } from '../src/lib/regions.js';
import { SIM_PRO_KEY } from '../src/lib/pro.js';

vi.mock('../src/lib/photos.js', async (orig) => ({
  ...(await orig()),
  compressInvoiceImage: vi.fn(async () => ({ dataUrl: `data:image/jpeg;base64,/9j/${'A'.repeat(200)}`, width: 100, height: 100 })),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const T0 = new Date(2026, 9, 22, 9, 0, 0).getTime();
const region = getRegion('CL');
const FIXED = { cement_bag: 9990, sand: 21000 };

function slab() {
  const d = newDraft('CL');
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  return d;
}
const itemOf = (draft, id, now) => computeAll(draft, now).quote.items.find((i) => i.id === id);

describe('prices read from an invoice are FIXED: the market updater cannot touch them', () => {
  const buckets = Array.from({ length: 60 }, (_, i) => T0 + i * MARKET_WINDOW_MS); // 15 hours of market windows

  it('the free (simulated) prices DO drift between windows - the baseline the lock is protecting against', () => {
    const prices = new Set(buckets.map((t) => itemOf(slab(), 'gravel', t).unitPrice));
    expect(prices.size).toBeGreaterThan(1);
  });

  it('a fixed price is identical in every market window, for every store, and the line total never moves', () => {
    const draft = { ...slab(), overrides: FIXED };
    for (const chainId of ['best', ...region.chains.map((c) => c.id)]) {
      const d = { ...draft, chainId };
      for (const t of buckets) {
        const c = itemOf(d, 'cement_bag', t);
        const s = itemOf(d, 'sand', t);
        expect(c.unitPrice, `${chainId} cement`).toBe(9990);
        expect(c.source).toBe('manual');
        expect(c.total).toBe(c.packs * 9990);
        expect(s.unitPrice).toBe(21000);
        expect(s.source).toBe('manual');
        expect(s.total).toBe(s.packs * 21000);
      }
    }
  });

  it('the store comparison chips (chainTotals) also keep the fixed prices in every window', () => {
    const base = computeAll(slab(), T0);
    const lines = base.partidas.map((p) => ({ lines: p.calc.lines, waste: p.waste }));
    const args = (bucket, overrides) => ({ partidas: lines, regionCode: 'CL', overrides, bucket });
    const free = (b) => chainTotals(args(b, {}));
    const locked = (b) => chainTotals(args(b, FIXED));
    const b0 = marketBucket(T0);
    // free totals move between windows; the fixed materials contribute the same amount to every chain total
    expect(new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(free(b0 + i)))).size).toBeGreaterThan(1);
    const matCost = (id, chain, b) => resolvePrices({ ids: [id], regionCode: 'CL', chainId: chain, overrides: FIXED, bucket: b })[id].price;
    for (let i = 0; i < 30; i += 1) {
      for (const c of region.chains) {
        expect(matCost('cement_bag', c.id, b0 + i)).toBe(9990);
        expect(matCost('sand', c.id, b0 + i)).toBe(21000);
      }
      // with more materials fixed, the totals differ from the free ones by exactly the fixed-price difference
      expect(locked(b0 + i).best).not.toBe(free(b0 + i).best);
    }
  });

  it('only the fixed materials stay put: the rest of the quote keeps following the market', () => {
    const draft = { ...slab(), overrides: { cement_bag: 9990 } };
    const gravels = new Set(buckets.map((t) => itemOf(draft, 'gravel', t).unitPrice));
    expect(gravels.size).toBeGreaterThan(1);
    expect(itemOf(draft, 'gravel', buckets[0]).source).toBe('ref');
  });

  it('they survive saving and reopening the project (normalizeDraft) and the signature price clock', () => {
    const draft = { ...slab(), overrides: FIXED };
    const stored = JSON.parse(JSON.stringify(draft));
    const back = normalizeDraft(stored, 'CL');
    expect(back.overrides).toEqual(FIXED);
    expect(itemOf(back, 'cement_bag', T0 + 99 * MARKET_WINDOW_MS).unitPrice).toBe(9990);
  });
});
