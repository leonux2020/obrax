// Colour of every project state (traffic light + "future" + finished). Used by the dashboard pills, the card's
// thick bottom border and the status pill inside a project, so the whole app speaks one colour language.
export const LEVEL_COLOR = Object.freeze({
  red: '#ef4444',
  orange: '#f97316',
  green: '#22c55e',
  future: '#3b82f6',
  none: '#525252',
  closed: '#737373',
});

/** The state text of a project ("Atraso de 5 d", "Vence hoy", "Inicia en 3 d", "Faltan 12 d"); '' when there is nothing to say. */
export function levelDetail(t, info) {
  if (info.level === 'red') return t('light.late', { n: info.daysLate });
  if (info.level === 'future') return t('light.starts', { n: info.daysUntilStart });
  const left = info.light?.daysLeft;
  if (info.level === 'orange' || info.level === 'green') return left === 0 ? t('light.today') : t('light.daysLeft', { n: left });
  return '';
}
