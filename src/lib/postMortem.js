// Numbers of the "Dashboard Post-Mortem" of a FINISHED project (read-only). Pure: no React, no storage.
//
//   Balance:  Presupuestado (the quote's total)  vs  Cobrado en Caja (payments)  and  Utilidad real
//             Utilidad real = Cobrado - Gastos reales, where Gastos reales = expenses (receipts, rentals...) + cash advanced to workers.
//             Margen = Utilidad real / Cobrado (null while nothing was collected).
//   Tiempos:  Días estimados (the plan: the project dates, else the schedule of the quote)  vs  Días reales según la bitácora
//             (first to last logbook day, both included). Without logbook entries: from the start date to the closing day.

import { LEDGER_LIMITS, cashSummary, dayOf, expensesTotal } from './ledger.js';
import { dayDiff, parseDay } from './projects.js';

const cents = (n) => Math.round(n * 100) / 100;
const spanDays = (from, to) => {
  const a = parseDay(from);
  const b = parseDay(to);
  return a && b ? Math.max(1, dayDiff(a, b) + 1) : null;
};

/** Planned duration in days: the dates of the project when both exist, else the quote's schedule, else null. */
export function estimatedDays(project, result, timeline = null) {
  const t = timeline ?? { startDate: project.startDate, endDate: project.endDate };
  const byDates = spanDays(t.startDate, t.endDate);
  if (byDates) return byDates;
  const total = result?.schedule?.totals?.totalDays;
  return Number.isFinite(total) && total > 0 ? Math.max(1, Math.ceil(total - 1e-9)) : null;
}

/** Real duration in days and where it comes from ('log' | 'dates'), or null when it cannot be told. */
export function actualDays(project) {
  const logDays = (project.logbook ?? []).filter((e) => e.at > 0).map((e) => dayOf(e.at)).sort();
  if (logDays.length) return { days: spanDays(logDays[0], logDays[logDays.length - 1]), source: 'log' };
  const end = project.closedAt > 0 ? dayOf(project.closedAt) : '';
  const start = project.startDate || (project.createdAt > 0 ? dayOf(project.createdAt) : '');
  const days = spanDays(start, end);
  return days ? { days, source: 'dates' } : { days: null, source: 'none' };
}

/**
 * @param project  a stored project (payments, advances, expenses, logbook...)
 * @param total    the quote's total with tax (null / 0 when the quote is incomplete)
 * @param result   computeAll() result (for the schedule), optional
 */
export function postMortem(project, { total = 0, result = null, timeline = null } = {}) {
  const budget = Number.isFinite(total) && total > 0 ? cents(total) : 0;
  const cash = cashSummary(budget, project.payments);
  const expenses = expensesTotal(project.expenses);
  const advances = cents((project.advances ?? []).reduce((s, a) => s + a.amount, 0));
  const spent = cents(expenses + advances);
  const profit = cents(cash.paid - spent);
  const estimated = estimatedDays(project, result, timeline);
  const actual = actualDays(project);
  return {
    budget,
    collected: cash.paid,
    pending: cash.pending,
    collectedPct: cash.pct,
    overpaid: cash.overpaid,
    expenses,
    advances,
    spent,
    profit,
    margin: cash.paid > 0 ? (profit / cash.paid) * 100 : null,
    days: {
      estimated,
      actual: actual.days,
      source: actual.source,
      delta: estimated !== null && actual.days !== null ? actual.days - estimated : null,
    },
    logbookCount: (project.logbook ?? []).length,
    limit: LEDGER_LIMITS.logbook,
  };
}
