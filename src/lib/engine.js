import { validateDims, runCalculation, effectiveWaste } from './tasks.js';
import { resolvePrices, buildQuote, chainTotals, marketBucket, planAll } from './pricing.js';
import { spanDays } from './schedule.js';
import { planMachinery, DEFAULT_MACHINERY } from './machinery.js';
import { effectiveBook } from './priceBook.js';
import { currentBook } from './priceRegistry.js';

/**
 * Single entry point used by the UI: draft -> validation per partida, takeoff, ONE consolidated
 * purchase plan, prices and quote.
 *
 *  - quick mode:   exactly one partida
 *  - `chains: false` skips the per-chain comparison (one extra quote per store chain): lists, cards and totals only
 *    need `valid` and `quote`, so they ask for the light result.
 *  - project mode: any number of partidas; shared materials (e.g. cement bags from a slab and a wall)
 *                  are summed into a single purchase line before rounding to whole sale units.
 */
export function computeAll(draft, now = Date.now(), { timeline = null, book: liveBook, chains = true, ignoreCapsule = false } = {}) {
  // The project's CAPSULE (lib/capsule.js): prices, rental rates and the tax rate frozen INSIDE the project. What it holds is never looked up
  // in the price book, the supplier directory or the market clock, so every device that has the same project computes the same total.
  const capsule = ignoreCapsule ? null : draft.capsule ?? null;
  const partidas = draft.partidas.map((p) => {
    const validation = validateDims(p.task, p.dims);
    return {
      id: p.id,
      name: p.name,
      task: p.task,
      waste: effectiveWaste(p.waste, p.task), // a missing / NaN waste falls back to the task's default, never to NaN or a silent 0
      validation,
      values: validation.values,
      calc: validation.valid ? runCalculation(p.task, validation.values) : null,
    };
  });

  const valid = partidas.length > 0 && partidas.every((p) => p.validation.valid);
  if (!valid) {
    return { valid: false, partidas, validation: partidas[0]?.validation ?? { values: {}, errors: {}, valid: false } };
  }

  const bucket = marketBucket(now);
  // Live market prices (price service) when there are any; a signed / frozen quote keeps the book it was agreed with.
  const book = effectiveBook(draft, liveBook !== undefined ? liveBook : currentBook(draft.regionCode));
  const inputs = partidas.map((p) => ({ lines: p.calc.lines, waste: p.waste }));
  const plan = planAll(inputs);
  const prices = resolvePrices({
    ids: plan.map((i) => i.id),
    regionCode: draft.regionCode,
    chainId: draft.chainId,
    overrides: draft.overrides,
    bucket,
    book,
    snapshot: capsule?.prices?.[draft.chainId],
  });
  // The job's real duration is the one the contractor typed (delivery date - start date): the major machinery rented for it is
  // priced per day of use, at the same 15-minute market window as materials. No theoretical crew / man-hours plan exists.
  const siteDays = spanDays(timeline?.startDate, timeline?.endDate);
  const machinery = planMachinery({ partidas, siteDays, regionCode: draft.regionCode, config: draft.machinery ?? DEFAULT_MACHINERY, bucket, book, rents: capsule?.rents });
  const quote = buildQuote({ partidas: inputs, plan, prices, finance: draft.finance, regionCode: draft.regionCode, machinery, taxFallback: capsule?.tax?.rate ?? null });
  const totals = !chains ? null : chainTotals({
    partidas: inputs,
    regionCode: draft.regionCode,
    overrides: draft.overrides,
    bucket,
    book,
    capsulePrices: capsule?.prices,
  });
  return {
    valid: true,
    mode: draft.mode,
    partidas,
    validation: partidas[0].validation,
    prices,
    quote,
    siteDays, // calendar days of the job (null while a date is missing)
    machinery,
    chainTotals: totals,
    book, // the price book that priced this quote (null = built-in reference prices)
    // true when EVERYTHING of this quote came out of the project's capsule (no global value was read)
    sealed: Boolean(capsule?.tax) && plan.every((i) => Boolean(prices[i.id]) && (draft.overrides?.[i.id] > 0 || Boolean(capsule?.prices?.[draft.chainId]?.[i.id]))) && machinery.items.every((it) => Boolean(capsule?.rents?.[it.id])),
  };
}
