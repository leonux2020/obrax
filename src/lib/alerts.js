import { dayOf, rentalsDue } from './ledger.js';

/**
 * Real exceptions of ONE project (exception-based UI: no exception, no alert). Today: rented tools / machinery whose return date is
 * today or already past and that are not marked as returned. Returns [{ id, level: 'today' | 'late', text }].
 */
export function projectAlerts(project, t, now = Date.now()) {
  const today = dayOf(now);
  return rentalsDue(project?.expenses, now).map((e) => {
    const late = e.returnDate < today;
    const name = e.supplier || e.description || t('exp.fallback');
    return { id: `rental-${e.id}`, level: late ? 'late' : 'today', text: t(late ? 'ws.alert.rentalLate' : 'ws.alert.rentalToday', { name }) };
  });
}
