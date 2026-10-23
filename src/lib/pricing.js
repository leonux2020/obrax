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
export const MARKET_WINDOW_MS = 900_000;
// A broken clock value (NaN, undefined, a string) can never poison the prices: it falls back to the real time.
export const marketBucket = (now = Date.now()) => Math.floor((Number.isFinite(now) ? now : Date.now()) / MARKET_WINDOW_MS);
/** Epoch ms at which the NEXT market window starts (when the prices change again). */
export const nextBucketAt = (now = Date.now()) => (marketBucket(now) + 1) * MARKET_WINDOW_MS;

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

const EPS = 1e-9;
const round4 = (n) => Math.round(n * 10000) / 10000;

/** Geometric need plus the waste allowance (still in base units, not yet rounded to sale units). */
export const withWaste = (qty, wastePct) => qty * (1 + wastePct / 100);

function packCuts(groups, size) {
  let packs = 0;
  for (const [len, pieces] of groups) {
    packs +=
      len <= size
        ? Math.ceil(pieces / Math.max(1, Math.floor(size / len + EPS)) - EPS)
        : pieces * Math.ceil(len / size - EPS);
  }
  return packs;
}

/**
 * Plan the purchase of ONE material from all the parts that need it (one part per partida).
 *  - sale formats are indivisible => packs are rounded UP to a whole number
 *  - `cut` parts (steel profiles) pack cut pieces into stock lengths: several short pieces fit in one
 *    profile, and pieces longer than the profile need several profiles each
 *  - materials with a `bulk` format (paint) are filled with big units first and finished with small ones
 *  - leftover = purchased - needed (with waste): reusable remnant, never negative
 * Quantities from different partidas are SUMMED before rounding (shared materials, one purchase line).
 * Returns one plan (two for bulk-split materials). `shares[idx]` = fraction of the line used by partida idx.
 *
 * @param {string} id catalog id
 * @param {{idx:number, qty:number, wastePct:number, cut?:{count:number,length:number}}[]} parts
 */
export function planMaterial(id, parts) {
  const mat = CATALOG[id];
  let need = 0;
  let needWaste = 0;
  let nonCut = 0;
  const cutGroups = new Map();
  const partWaste = {};

  for (const part of parts) {
    need += part.qty;
    let w;
    if (part.cut && part.cut.length > 0) {
      const pieces = Math.ceil(withWaste(part.cut.count, part.wastePct) - EPS);
      const key = round4(part.cut.length);
      cutGroups.set(key, (cutGroups.get(key) || 0) + pieces);
      w = pieces * part.cut.length;
    } else {
      w = withWaste(part.qty, part.wastePct);
      nonCut += w;
    }
    needWaste += w;
    partWaste[part.idx] = (partWaste[part.idx] || 0) + w;
  }

  const shares = {};
  for (const [idx, w] of Object.entries(partWaste)) shares[idx] = needWaste > 0 ? w / needWaste : 1 / parts.length;

  const finish = (planId, planNeed, planNeedWaste, packs, size) => {
    const purchased = round4(packs * size);
    const leftover = Math.max(0, round4(purchased - planNeedWaste));
    return {
      id: planId,
      need: round4(planNeed),
      needWaste: round4(planNeedWaste),
      packs,
      purchased,
      leftover,
      leftoverPct: purchased > 0 ? leftover / purchased : 0,
      shares,
    };
  };

  // Bulk + small format (paint): big units first, small units for the remainder.
  if (mat.bulk && cutGroups.size === 0) {
    const big = CATALOG[mat.bulk];
    let full = Math.floor(needWaste / big.size + EPS);
    const rem = needWaste - full * big.size;
    let small = rem > EPS ? Math.ceil(rem / mat.size - EPS) : 0;
    if (small * mat.size >= big.size - EPS && small > 0) {
      full += 1; // buying the big unit is never worse than a full set of small ones
      small = 0;
    }
    const plans = [];
    const bigNeedWaste = Math.min(needWaste, full * big.size);
    const portion = needWaste > 0 ? bigNeedWaste / needWaste : 0;
    if (full > 0) plans.push(finish(mat.bulk, need * portion, bigNeedWaste, full, big.size));
    if (small > 0) plans.push(finish(id, need * (1 - portion), needWaste - bigNeedWaste, small, mat.size));
    if (plans.length) return plans;
  }

  let packs = nonCut > 0 ? Math.ceil(nonCut / mat.size - EPS) : 0;
  packs += packCuts(cutGroups, mat.size);
  if (need > 0) packs = Math.max(1, packs);
  return [finish(id, need, needWaste, packs, mat.size)];
}

/** Single-line convenience wrapper (one partida). For bulk-split materials returns the first plan. */
export function planPurchase(line, wastePct) {
  const [plan] = planMaterial(line.id, [{ idx: 0, qty: line.qty, wastePct, cut: line.cut }]);
  return plan;
}

/**
 * Consolidate the takeoff lines of every partida into ONE purchase plan.
 * @param {{lines:{id:string,qty:number,cut?:object}[], waste:number}[]} partidas
 */
export function planAll(partidas) {
  const byId = new Map();
  partidas.forEach((p, idx) => {
    for (const l of p.lines) {
      if (!byId.has(l.id)) byId.set(l.id, []);
      byId.get(l.id).push({ idx, qty: l.qty, wastePct: p.waste, cut: l.cut });
    }
  });
  const plans = [];
  for (const [id, parts] of byId) plans.push(...planMaterial(id, parts));
  return plans;
}

/** Tax rate actually applied: the user's value for editable regions, otherwise the official rate. */
export function taxRateFor(region, finance) {
  const custom = finance && typeof finance.tax === 'number' ? finance.tax : null;
  if (region.taxEditable && custom !== null && custom >= 0 && custom <= 50) return custom / 100;
  return region.taxRate;
}

/** Accept the multi-partida shape, or the legacy single-list shape used by older callers/tests. */
function toPartidas({ partidas, lines, finance }) {
  if (partidas) return partidas;
  return [{ lines, waste: finance.waste ?? 0 }];
}

/**
 * Build the full quote: consolidated purchase lines (whole sale units), labor/transport,
 * official VAT breakdown and the amount allocated to every partida (chapter).
 */
export function buildQuote({ partidas, lines, plan, prices, finance, regionCode, machinery = null }) {
  const region = getRegion(regionCode);
  const parts = toPartidas({ partidas, lines, finance });
  const planned = plan || planAll(parts);
  const items = planned.map((pl) => {
    const mat = CATALOG[pl.id];
    const { price, ref, source, chainId } = prices[pl.id];
    const total = roundMoney(pl.packs * price, region);
    return {
      id: pl.id,
      baseUnit: mat.base,
      saleUnit: mat.sale,
      saleSize: mat.size,
      need: pl.need,
      needWaste: pl.needWaste,
      packs: pl.packs,
      purchased: pl.purchased,
      leftover: pl.leftover,
      leftoverPct: pl.leftoverPct,
      shares: pl.shares,
      unitPrice: price, // per SALE unit
      refPrice: ref,
      source,
      chainId,
      total,
      leftoverValue: roundMoney((pl.leftover / mat.size) * price, region),
    };
  });

  const materials = roundMoney(items.reduce((s, i) => s + i.total, 0), region);
  const leftoverValue = roundMoney(items.reduce((s, i) => s + i.leftoverValue, 0), region);
  const labor = roundMoney((materials * finance.labor) / 100, region);
  const transport = roundMoney((materials * finance.transport) / 100, region);
  // Major machinery rental is an indirect cost added on top (see machinery.js): { total, byPartida }.
  const machineryTotal = machinery ? roundMoney(machinery.total, region) : 0;
  // Imprevistos and Utilidad (both 0 unless the user sets them): contingency on the direct costs, profit on top of it
  const direct = materials + labor + transport + machineryTotal;
  const contingency = roundMoney((direct * (finance.contingency || 0)) / 100, region);
  const profit = roundMoney(((direct + contingency) * (finance.profit || 0)) / 100, region);
  const subtotal = roundMoney(direct + contingency + profit, region);
  const taxRate = taxRateFor(region, finance);
  const tax = roundMoney(subtotal * taxRate, region);
  const total = roundMoney(subtotal + tax, region);

  // Allocate materials and net amount to partidas by their share of each consolidated line.
  const raw = parts.map(() => 0);
  for (const i of items) for (const [idx, f] of Object.entries(i.shares)) raw[Number(idx)] += i.total * f;
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const weights = raw.map((v) => (rawSum > 0 ? v / rawSum : 1 / parts.length));
  const allocate = (amount) => {
    let acc = 0;
    return weights.map((w, k) => {
      const v = k === weights.length - 1 ? roundMoney(amount - acc, region) : roundMoney(amount * w, region);
      acc += v;
      return v;
    });
  };
  const matAlloc = allocate(materials);
  // Machinery belongs to the partida that needs it; everything else is shared by material weight.
  const netAlloc = allocate(roundMoney(subtotal - machineryTotal, region)).map((v, k) => roundMoney(v + (machinery?.byPartida?.[k] ?? 0), region));
  const partidaTotals = parts.map((_, k) => ({ index: k, materials: matAlloc[k], amount: netAlloc[k] }));

  return {
    items,
    materials,
    leftoverValue,
    labor,
    transport,
    machinery: machineryTotal,
    contingency,
    profit,
    subtotal,
    tax,
    total,
    taxRate,
    taxName: region.taxName,
    partidas: partidaTotals,
  };
}

/** Estimated materials total for each chain (for the comparison chips). */
export function chainTotals({ partidas, lines, regionCode, wastePct = 0, overrides, bucket = marketBucket() }) {
  const region = getRegion(regionCode);
  const parts = partidas || [{ lines, waste: wastePct }];
  const plan = planAll(parts);
  const ids = plan.map((p) => p.id);
  const totalFor = (chainId) => {
    const prices = resolvePrices({ ids, regionCode, chainId, overrides, bucket });
    return buildQuote({
      partidas: parts,
      plan,
      prices,
      finance: { labor: 0, transport: 0, tax: null },
      regionCode,
    }).materials;
  };
  const result = { best: totalFor('best') };
  for (const c of region.chains) result[c.id] = totalFor(c.id);
  return result;
}
