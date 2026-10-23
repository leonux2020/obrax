// Colour of every project state (traffic light + "future" + finished). Used by the dashboard pills, the card's
// thick bottom border and the status pill inside a project, so the whole app speaks one colour language.
export const LEVEL_COLOR = Object.freeze({
  red: '#ff2b2b',
  orange: '#ff9500',
  green: '#00d95f',
  future: '#2d8cff',
  none: '#525252',
  closed: '#737373',
});

/** The state text of a project ("Atraso de 5 d", "Vence hoy", "Inicia en 3 d", "Faltan 12 d"); '' when there is nothing to say. */
export function levelDetail(t, info) {
  if (info.level === 'red') return t('light.late', { n: info.daysLate });
  if (info.level === 'future') return t('light.starts', { n: info.daysUntilStart });
  const left = info.light?.daysLeft;
  if (left === null || left === undefined) return t('light.none'); // no end date: nothing to count down
  if (info.level === 'orange' || info.level === 'green') return left === 0 ? t('light.today') : t('light.daysLeft', { n: left });
  return '';
}
