import { validateDims, runCalculation } from './tasks.js';
import { resolvePrices, buildQuote, chainTotals, marketBucket, planAll } from './pricing.js';
import { planProject } from './schedule.js';
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
export function computeAll(draft, now = Date.now(), { timeline = null, book: liveBook, chains = true } = {}) {
  const partidas = draft.partidas.map((p) => {
    const validation = validateDims(p.task, p.dims);
    return {
      id: p.id,
      name: p.name,
      task: p.task,
      waste: p.waste,
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
  });
  // Crew plan (HH vs dead technical time, crew derived from the project's deadline unless set by hand) and
  // the major machinery it implies (rented per day of use, at the same 15-minute market window as materials).
  const schedule = planProject(partidas, draft, timeline, now);
  const machinery = planMachinery({ partidas, schedule, regionCode: draft.regionCode, config: draft.machinery ?? DEFAULT_MACHINERY, bucket, book });
  const quote = buildQuote({ partidas: inputs, plan, prices, finance: draft.finance, regionCode: draft.regionCode, machinery });
  const totals = !chains ? null : chainTotals({
    partidas: inputs,
    regionCode: draft.regionCode,
    overrides: draft.overrides,
    bucket,
    book,
  });
  return {
    valid: true,
    mode: draft.mode,
    partidas,
    validation: partidas[0].validation,
    prices,
    quote,
    schedule,
    machinery,
    chainTotals: totals,
    book, // the price book that priced this quote (null = built-in reference prices)
  };
}
