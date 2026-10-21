import { validateDims, runCalculation } from './tasks.js';
import { resolvePrices, buildQuote, chainTotals, marketBucket } from './pricing.js';
/** Single entry point used by the UI: draft -> validation, takeoff, prices and quote. */
export function computeAll(draft, now = Date.now()) {
  const validation = validateDims(draft.task, draft.dims);
  if (!validation.valid) return { valid: false, validation };

  const bucket = marketBucket(now);
  const calc = runCalculation(draft.task, validation.values);
  const ids = calc.lines.map((l) => l.id);
  const prices = resolvePrices({
    ids,
    regionCode: draft.regionCode,
    chainId: draft.chainId,
    overrides: draft.overrides,
    bucket,
  });
  const quote = buildQuote({ lines: calc.lines, prices, finance: draft.finance, regionCode: draft.regionCode });
  const totals = chainTotals({
    lines: calc.lines,
    regionCode: draft.regionCode,
    wastePct: draft.finance.waste,
    overrides: draft.overrides,
    bucket,
  });
  return { valid: true, validation, values: validation.values, calc, prices, quote, chainTotals: totals };
}
