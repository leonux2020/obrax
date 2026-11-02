// Budget total (tax included) of a project at a given moment, with exactly the rules the project screens use:
// frozen / signed quotes keep their price time and dates; the rest follow the live market window and dates.

import { computeAll } from './engine.js';
import { planningTimeline, pricingTime } from './signature.js';
import { currentBook, currentSuppliers } from './priceRegistry.js';
import { applyNearby } from './suppliers.js';

/** Total with tax, or null while the project has no valid measures yet. */
export function projectTotal(project, now = Date.now()) {
  const code = project.draft.regionCode;
  const book = applyNearby(currentBook(code), code, currentSuppliers(code), project.location); // the supplier prices within 50 km of the job
  const r = computeAll(project.draft, pricingTime(project.draft, now), { timeline: planningTimeline(project.draft, project), book, chains: false });
  return r.valid ? r.quote.total : null;
}

export function projectTotals(projects, now = Date.now()) {
  return new Map(projects.map((p) => [p.id, projectTotal(p, now)]));
}
