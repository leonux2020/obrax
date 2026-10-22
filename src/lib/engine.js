import { validateDims, runCalculation } from './tasks.js';
import { resolvePrices, buildQuote, chainTotals, marketBucket, planAll } from './pricing.js';
import { planProject } from './schedule.js';
import { planMachinery, DEFAULT_MACHINERY } from './machinery.js';

/**
 * Single entry point used by the UI: draft -> validation per partida, takeoff, ONE consolidated
 * purchase plan, prices and quote.
 *
 *  - quick mode:   exactly one partida
 *  - project mode: any number of partidas; shared materials (e.g. cement bags from a slab and a wall)
 *                  are summed into a single purchase line before rounding to whole sale units.
 */
export function computeAll(draft, now = Date.now(), { timeline = null } = {}) {
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
  const inputs = partidas.map((p) => ({ lines: p.calc.lines, waste: p.waste }));
  const plan = planAll(inputs);
  const prices = resolvePrices({
    ids: plan.map((i) => i.id),
    regionCode: draft.regionCode,
    chainId: draft.chainId,
    overrides: draft.overrides,
    bucket,
  });
  // Crew plan (HH vs dead technical time, crew derived from the project's deadline unless set by hand) and
  // the major machinery it implies (rented per day of use, at the same 15-minute market window as materials).
  const schedule = planProject(partidas, draft, timeline, now);
  const machinery = planMachinery({ partidas, schedule, regionCode: draft.regionCode, config: draft.machinery ?? DEFAULT_MACHINERY, bucket });
  const quote = buildQuote({ partidas: inputs, plan, prices, finance: draft.finance, regionCode: draft.regionCode, machinery });
  const totals = chainTotals({
    partidas: inputs,
    regionCode: draft.regionCode,
    overrides: draft.overrides,
    bucket,
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
  };
}
