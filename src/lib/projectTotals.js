// Budget total (tax included) of a project at a given moment, with exactly the rules the project screens use:
// frozen / signed quotes keep their price time and dates; the rest follow the live market window and dates.
//
// THE CAPSULE: a quote is only deterministic if it reads nothing but the project itself. `sealProject` copies the prices, rental rates and tax
// the quote needs into `draft.capsule` (see capsule.js) the moment they are needed; from then on `computeAll` reads the capsule and never the price
// book, the supplier directory or the market clock. `recalculateProjectTotals` is the post-merge middleware: it seals whatever the merge left
// uncovered and rewrites the derived totals stored in the project, so what is saved (and shown on the Dashboard) is identical on every device.

import { computeAll } from './engine.js';
import { planningTimeline, pricingTime } from './signature.js';
import { currentBook, currentSuppliers } from './priceRegistry.js';
import { applyNearby } from './suppliers.js';
import { getRegion } from './regions.js';
import { cashSummary, expensesTotal } from './ledger.js';
import { canon } from './merge.js';
import { normalizeCapsule, releaseCapsule } from './capsule.js';

const liveBookOf = (project) => {
  const code = project.draft.regionCode;
  return applyNearby(currentBook(code), code, currentSuppliers(code), project.location); // the supplier prices within 50 km of the job
};

/** Total with tax, or null while the project has no valid measures yet. */
export function projectTotal(project, now = Date.now()) {
  const r = computeAll(project.draft, pricingTime(project.draft, now), { timeline: planningTimeline(project.draft, project), book: liveBookOf(project), chains: false });
  return r.valid ? r.quote.total : null;
}

export function projectTotals(projects, now = Date.now()) {
  return new Map(projects.map((p) => [p.id, projectTotal(p, now)]));
}

/**
 * Copy into the project's capsule every price / rental rate / tax the quote needs and the capsule does not hold yet (a hard copy of the
 * values of THIS moment). Entries already in the capsule are never touched. Returns the SAME object when there is nothing to add or the
 * quote is not valid yet (a project with an unfinished partida is sealed when it is completed).
 * `at` is the stamp of the new entries (the merge keeps the newest): 1 = "taken because it was missing", beaten by any real edit.
 */
export function sealProject(project, { now = Date.now(), at = now } = {}) {
  const draft = project?.draft;
  if (!draft || !getRegion(draft.regionCode)) return project;
  const live = computeAll({ ...draft, overrides: {}, capsule: null }, pricingTime(draft, now), {
    timeline: planningTimeline(draft, project),
    book: liveBookOf(project),
    chains: false,
    ignoreCapsule: true,
  });
  if (!live.valid) return project;
  const cap = normalizeCapsule(draft.capsule) || { v: 1, prices: {}, rents: {} };
  const stamp = Math.max(1, Math.round(at));
  const chainKey = draft.chainId;
  let changed = false;

  const have = cap.prices[chainKey] || {};
  const add = {};
  for (const item of live.quote.items) {
    if (have[item.id]) continue;
    const p = live.prices[item.id];
    add[item.id] = { p: p.price, r: p.ref, s: p.source === 'manual' ? 'ref' : p.source, c: p.chainId, at: stamp };
  }
  const prices = Object.keys(add).length ? { ...cap.prices, [chainKey]: { ...have, ...add } } : cap.prices;
  if (prices !== cap.prices) changed = true;

  const rents = { ...cap.rents };
  for (const it of live.machinery.items) {
    if (rents[it.id]) continue;
    rents[it.id] = { p: it.rate, s: it.source, at: stamp };
    changed = true;
  }

  let tax = cap.tax;
  if (!tax) {
    tax = { rate: getRegion(draft.regionCode).taxRate, at: stamp };
    changed = true;
  }
  if (!changed) return project;
  return { ...project, draft: { ...draft, capsule: normalizeCapsule({ v: 1, tax, prices, rents }) } };
}

/** "Update prices": the market prices the capsule took are released and taken again from the live book (a signed / frozen quote does not move). */
export function repriceProject(project, opts = {}) {
  if (!project?.draft || project.draft.signature || project.draft.frozen) return project;
  return sealProject({ ...project, draft: releaseCapsule(project.draft) }, opts);
}

/** The derived totals stored inside the project: budget with tax, collected, "Monto da incassare" (pending) and expenses. Never NaN. */
export function computeTotals(project, now = Date.now()) {
  const total = projectTotal(project, now);
  const cash = cashSummary(total ?? 0, project.payments);
  return { total, paid: cash.paid, pending: total === null ? null : cash.pending, expensesTotal: expensesTotal(project.expenses) };
}

/**
 * Post-merge middleware. Runs on a project right AFTER the deep merge and BEFORE it is saved to IndexedDB: seals what the merge left
 * uncovered by the capsule and rewrites `project.totals` from the merged data, so the stored JSON never carries stale derived figures.
 * Returns the same object when nothing changed.
 */
export function recalculateProjectTotals(project, { now = Date.now(), at = 1 } = {}) {
  if (!project?.draft) return project;
  const sealed = sealProject(project, { now, at });
  const totals = computeTotals(sealed, now);
  if (sealed === project && project.totals && canon(project.totals) === canon(totals)) return project;
  return { ...sealed, totals };
}
