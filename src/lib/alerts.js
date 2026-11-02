import { collectionDelay, dayOf, projectReceivable, rentalsDue } from './ledger.js';
import { isClosed, projectClient, projectLevel, projectTitle } from './projects.js';

/**
 * Real exceptions of ONE project (exception-based UI: no exception, no alert). Everything is derived from data that already exists:
 *
 *   deadline  the end date has passed (traffic light red) -> 'late'; or the crew plan cannot fit the deadline (`fits === false`) -> 'short'
 *   cobro     a balance is pending and more than 15 days went by without a client payment (ledger.collectionDelay)
 *   rental    a rented tool / machine is due back today (-> 'today') or already overdue (-> 'late'), not marked as returned
 *   receipt   a receipt photo of the deferred queue needs the user: 'review' (other currency) or 'failed' (unreadable)
 *
 * @param project  the stored project
 * @param t        i18n translate
 * @param opts     { now, budget (total with tax | null), fits (schedule fits the deadline | null), queue (queue rows of ANY project), money (n => text) }
 * @returns {{ id, kind: 'deadline'|'collection'|'rental'|'receipt', level: string, text: string }[]}  most serious first
 */
export function projectAlerts(project, t, { now = Date.now(), budget = null, fits = null, queue = [], money = (n) => String(n) } = {}) {
  const out = [];
  const name = projectTitle(project) || t('proj.untitled');

  if (!isClosed(project)) {
    const late = projectLevel(project, now).level === 'red';
    if (late) out.push({ id: 'deadline', kind: 'deadline', level: 'late', text: t('ws.alert.deadlineLate', { name }) });
    else if (fits === false) out.push({ id: 'deadline', kind: 'deadline', level: 'short', text: t('ws.alert.deadlineShort', { name }) });
  }

  if (collectionDelay(project, budget, now) > 0) {
    out.push({ id: 'collection', kind: 'collection', level: 'late', text: t('ws.alert.collection', { name: projectClient(project) || name, amount: money(projectReceivable(project, budget)) }) });
  }

  const today = dayOf(now);
  for (const e of rentalsDue(project?.expenses, now)) {
    const late = e.returnDate < today;
    out.push({ id: `rental-${e.id}`, kind: 'rental', level: late ? 'late' : 'today', text: t(late ? 'ws.alert.rentalLate' : 'ws.alert.rentalToday', { name: e.supplier || e.description || t('exp.fallback') }) });
  }

  for (const r of queue) {
    if (r.projectId !== project.id || (r.status !== 'review' && r.status !== 'failed')) continue;
    out.push({ id: `receipt-${r.id}`, kind: 'receipt', level: r.status, text: t(r.status === 'review' ? 'ws.alert.receiptReview' : 'ws.alert.receiptFailed') });
  }
  return out;
}
