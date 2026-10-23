// Major machinery suggestions (Phase 3). The engine proposes the rental of heavy equipment that the work
// really needs and adds it to the quote as an INDIRECT cost (it is not a material). Small hand tools
// (trowels, drills, levels, rollers, wheelbarrows...) are intentionally NOT modelled: they are the
// crew's own equipment and never part of the budget.
//
// Rates are SIMULATED like the material prices: USD base x regional fx x regional price index x a stable
// per-country spread. Rental days follow the crew plan (see schedule.js): a bigger crew finishes sooner
// and the machine is rented for fewer days.

import { getRegion } from './regions.js';
import { roundMoney, marketBucket } from './pricing.js';
import { MACHINES, MACHINE_IDS } from './machines.js';
import { liveRent } from './priceBook.js';

export { MACHINES, MACHINE_IDS };

/** Thresholds of the suggestion rules (documented so they are easy to review and tune). */
export const MACHINE_RULES = Object.freeze({
  mixerMinVolumeM3: 0.8, // below this, hand mixing is usual
  compactorMinAreaM2: 30, // sub-base compaction of a larger slab
  scaffoldMinWallHeightM: 3, // working height above which a certified scaffold replaces ladders
  scaffoldBayM: 6, // one set covers ~6 m of wall / ridge
  maxSets: 12,
});

const metric = (p, key) => p.calc?.metrics?.find((m) => m.key === key)?.value ?? 0;
const sets = (meters) => Math.min(MACHINE_RULES.maxSets, Math.max(1, Math.ceil(meters / MACHINE_RULES.scaffoldBayM)));

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Daily rental rate in the region's currency. Like the material prices it follows the 15-minute market
 * window (a slow +-1.5 % drift on top of a stable per-country spread), so rentals refresh together with them.
 */
export function machineryRate(id, regionCode, bucket = marketBucket(), book = null) {
  const region = getRegion(regionCode);
  const noise = (seed) => (hash(seed) / 4294967295) * 2 - 1;
  const spread = 1 + noise(`${region.code}|machine|${id}`) * 0.05;
  const drift = 1 + noise(`${bucket}|${region.code}|machine|${id}`) * 0.015;
  const live = liveRent(book, region.code, id);
  if (live > 0) return roundMoney(live * spread, region); // a live market rate replaces the simulated base (and its drift)
  const rate = roundMoney(MACHINES[id].usd * region.fx * region.priceFactor * spread * drift, region);
  return rate > 0 ? rate : 10 ** -region.digits;
}

/**
 * Which machines does each valid partida need, for how many units and days?
 * @param partidas computeAll() partidas  @param schedule buildSchedule() result
 * @returns {{id, partida, task, qty, days}[]}
 */
export function suggestMachinery(partidas, schedule) {
  const out = [];
  partidas.forEach((p, index) => {
    if (!p.calc) return;
    const active = schedule.rows[index]?.activeDays ?? 1;
    const days = Math.max(1, Math.ceil(active));
    const push = (id, qty, d) => out.push({ id, partida: index, task: p.task, qty, days: d });
    switch (p.task) {
      case 'slab':
        if (metric(p, 'volume') >= MACHINE_RULES.mixerMinVolumeM3) push('mixer', 1, Math.max(1, Math.ceil(active * 0.5))); // concrete is ~half of the job
        if (metric(p, 'area') >= MACHINE_RULES.compactorMinAreaM2) push('compactor', 1, 1);
        break;
      case 'roof':
        push('scaffold', sets(metric(p, 'ridgeLength')), days + 1); // always: work at height; +1 day to assemble / dismantle
        break;
      case 'masonry':
      case 'drywall':
      case 'paint':
        if (p.values.height >= MACHINE_RULES.scaffoldMinWallHeightM) push('scaffold', sets(p.values.length), days + 1);
        break;
      default:
        break;
    }
  });
  return out;
}

export const DEFAULT_MACHINERY = Object.freeze({ include: true, excluded: [] });

/**
 * Suggestions priced and split into included / excluded by the user's choices.
 * `config` = { include: master switch, excluded: machine ids the user turned off }.
 * @returns {{items, total, byPartida, suggested}} total and byPartida count only the INCLUDED items.
 */
export function planMachinery({ partidas, schedule, regionCode, config = DEFAULT_MACHINERY, bucket = marketBucket(), book = null }) {
  const region = getRegion(regionCode);
  const include = config?.include !== false;
  const excluded = new Set(config?.excluded ?? []);
  const items = suggestMachinery(partidas, schedule).map((s) => {
    const rate = machineryRate(s.id, regionCode, bucket, book);
    return { ...s, rate, total: roundMoney(s.qty * s.days * rate, region), included: include && !excluded.has(s.id) };
  });
  const byPartida = partidas.map(() => 0);
  let total = 0;
  for (const it of items) {
    if (!it.included) continue;
    total += it.total;
    byPartida[it.partida] += it.total;
  }
  return {
    include,
    items,
    total: roundMoney(total, region),
    byPartida: byPartida.map((v) => roundMoney(v, region)),
    suggested: items.length > 0,
  };
}
