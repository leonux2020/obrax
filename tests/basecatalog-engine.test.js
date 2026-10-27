// The simulated reference price of the quote engine is read FROM the bundled base-catalog JSON (layer 3 of the price chain).
import { describe, it, expect, vi } from 'vitest';
import raw from '../src/data/baseCatalog.json';

vi.mock('../src/data/baseCatalog.json', async (orig) => {
  const real = (await orig()).default;
  const items = Object.fromEntries(Object.entries(real.items).map(([id, it]) => [id, { ...it, usd: it.usd * (id === 'cement_bag' ? 2 : 1) }]));
  return { default: { ...real, items } };
});

import { referencePrice } from '../src/lib/pricing.js';
import { getRegion } from '../src/lib/regions.js';
import { CATALOG } from '../src/lib/catalog.js';

describe('engine <- base catalog JSON', () => {
  it('changing a price in the JSON changes the quote price of that material only', () => {
    const region = getRegion('CL');
    const chain = region.chains[0];
    const normal = (id) => CATALOG[id].usd * region.fx * region.priceFactor * chain.factor; // what the OLD in-code table gives (before spread / drift)
    const cement = referencePrice('cement_bag', region, chain, 5, null);
    const sand = referencePrice('sand', region, chain, 5, null);
    expect(cement / normal('cement_bag')).toBeGreaterThan(1.8); // doubled by the JSON (spread/drift are only a few %)
    expect(cement / normal('cement_bag')).toBeLessThan(2.2);
    expect(sand / normal('sand')).toBeGreaterThan(0.9);
    expect(sand / normal('sand')).toBeLessThan(1.1);
    expect(raw).toBeTruthy();
  });
});
