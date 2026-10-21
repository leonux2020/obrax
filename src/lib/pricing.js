// Local material price SIMULATION engine.
// Reference price = USD base * regional fx * regional index * chain positioning
//                   * stable per-(chain,material) spread * slow "market drift" (15-min window).
// Deterministic (no network): identical inputs in the same 15-minute window always give identical prices.
// User manual corrections always win over the reference price.

import { CATALOG } from './catalog.js';
import { getRegion } from './regions.js';

export const MAX_PRICE = 1_000_000_000;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** deterministic pseudo-random in [-1, 1] */
const noise = (seed) => (fnv1a(seed) / 4294967295) * 2 - 1;

// 15-minute market window: prices drift slowly and identically for everyone within it
export const marketBucket = (now = Date.now()) => Math.floor(now / 900_000);

export function roundMoney(value, region) {
  const f = 10 ** region.digits;
  return Math.round(value * f) / f;
}

export function referencePrice(materialId, region, chain, bucket = marketBucket()) {
  const mat = CATALOG[materialId];
  const base = mat.usd * region.fx * region.priceFactor * chain.factor;
  const spread = 1 + noise(`${region.code}|${chain.id}|${materialId}`) * 0.06;
  const drift = 1 + noise(`${bucket}|${region.code}|${materialId}`) * 0.015;
  const price = roundMoney(base * spread * drift, region);
  return price > 0 ? price : 10 ** -region.digits;
}

/**
 * Resolve the effective unit price of each material.
 * chainId === 'best' => cheapest chain for every item.
 * @returns {Record<string,{price:number, ref:number, source:'ref'|'manual', chainId:string}>}
 */
export function resolvePrices({ ids, regionCode, chainId, overrides = {}, bucket = marketBucket() }) {
  const region = getRegion(regionCode);
  const out = {};
  for (const id of ids) {
    let chain;
    let ref;
    if (chainId === 'best' || !region.chains.some((c) => c.id === chainId)) {
      for (const c of region.chains) {
        const p = referencePrice(id, region, c, bucket);
        if (ref === undefined || p < ref) {
          ref = p;
          chain = c;
        }
      }
    } else {
      chain = region.chains.find((c) => c.id === chainId);
      ref = referencePrice(id, region, chain, bucket);
    }
    const manual = overrides[id];
    const hasManual = typeof manual === 'number' && manual > 0 && manual <= MAX_PRICE;
    out[id] = { price: hasManual ? manual : ref, ref, source: hasManual ? 'manual' : 'ref', chainId: chain.id };
  }
  return out;
}

export function applyWaste(qty, wastePct, discrete) {
  const gross = qty * (1 + wastePct / 100);
  if (discrete) return Math.ceil(gross - 1e-9);
  return Math.ceil(gross * 100 - 1e-9) / 100;
}

/** Build the full quote: line items + labor/transport/tax totals. */
export function buildQuote({ lines, prices, finance, regionCode }) {
  const region = getRegion(regionCode);
  const items = lines.map((l) => {
    const mat = CATALOG[l.id];
    const qty = applyWaste(l.qty, finance.waste, mat.discrete);
    const { price, ref, source, chainId } = prices[l.id];
    return {
      id: l.id,
      unit: mat.unit,
      net: mat.discrete ? Math.ceil(l.qty - 1e-9) : Math.round(l.qty * 100) / 100,
      qty,
      unitPrice: price,
      refPrice: ref,
      source,
      chainId,
      total: roundMoney(qty * price, region),
    };
  });
  const materials = roundMoney(items.reduce((s, i) => s + i.total, 0), region);
  const labor = roundMoney((materials * finance.labor) / 100, region);
  const transport = roundMoney((materials * finance.transport) / 100, region);
  const subtotal = roundMoney(materials + labor + transport, region);
  const tax = roundMoney(subtotal * region.taxRate, region);
  const total = roundMoney(subtotal + tax, region);
  return { items, materials, labor, transport, subtotal, tax, total, taxRate: region.taxRate };
}

/** Estimated materials total for each chain (for the comparison chips). */
export function chainTotals({ lines, regionCode, wastePct, overrides, bucket = marketBucket() }) {
  const region = getRegion(regionCode);
  const ids = lines.map((l) => l.id);
  const totalFor = (chainId) => {
    const prices = resolvePrices({ ids, regionCode, chainId, overrides, bucket });
    return buildQuote({
      lines,
      prices,
      finance: { waste: wastePct, labor: 0, transport: 0 },
      regionCode,
    }).materials;
  };
  const result = { best: totalFor('best') };
  for (const c of region.chains) result[c.id] = totalFor(c.id);
  return result;
}
