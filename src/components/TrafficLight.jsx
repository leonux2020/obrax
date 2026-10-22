import { useI18n } from '../lib/i18n.jsx';

const DOT = {
  green: { background: '#22c55e', boxShadow: '0 0 10px 1px rgba(34,197,94,0.55)' },
  orange: { background: '#f97316', boxShadow: '0 0 10px 1px rgba(249,115,22,0.55)' },
  red: { background: '#ef4444', boxShadow: '0 0 10px 1px rgba(239,68,68,0.6)' },
  none: { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' },
};

/** Time traffic light: coloured dot + text (never colour alone). `light` comes from trafficLight(). */
export default function TrafficLight({ light }) {
  const { t } = useI18n();
  const { level, daysLeft } = light;
  let detail = '';
  if (level === 'red') detail = t('light.late', { n: Math.abs(daysLeft) });
  else if (level !== 'none') detail = daysLeft === 0 ? t('light.today') : t('light.daysLeft', { n: daysLeft });
  const label = t(`light.${level}`);
  return (
    <span
      role="img"
      aria-label={`${t('light.label')}: ${label}${detail ? `, ${detail}` : ''}`}
      data-level={level}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm font-bold"
    >
      <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full" style={DOT[level]} />
      <span aria-hidden="true" className="truncate">
        {label}
        {detail && <span className="font-medium text-neutral-300"> · {detail}</span>}
      </span>
    </span>
  );
}
