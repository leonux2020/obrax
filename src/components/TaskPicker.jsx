import { useI18n } from '../lib/i18n.jsx';
import { TASK_IDS } from '../lib/tasks.js';

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinejoin: 'round', strokeLinecap: 'round' };

const ICONS = {
  slab: <path d="M4 30 L24 20 L44 30 L24 40 Z M4 30 V35 L24 45 L44 35 V30 M24 40 V45" {...STROKE} />,
  masonry: <path d="M5 10H43V38H5Z M5 19.3H43 M5 28.6H43 M18 10V19.3 M31 19.3V28.6 M18 28.6V38 M31 10V19.3" {...STROKE} />,
  drywall: <path d="M8 6H40V42H8Z M16 6V42 M24 6V42 M32 6V42" {...STROKE} />,
  roof: <path d="M3 26 L24 9 L45 26 M9 22 V40 H39 V22 M20 40 V30 H28 V40" {...STROKE} />,
  floor: <path d="M6 12H42V38H6Z M24 12V38 M6 25H42 M15 12V25 M33 25V38" {...STROKE} />,
  paint: <path d="M9 8H35V19H9Z M35 13H41V26H24V32 M21 32H27V43H21Z" {...STROKE} />,
};

export function TaskIcon({ id, size = 40 }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      {ICONS[id]}
    </svg>
  );
}

/** Radio group of the six work types. `compact` = dense grid used inside the partida editor. */
export default function TaskPicker({ value, onChange, labelledBy, compact = false }) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={compact ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'}
    >
      {TASK_IDS.map((id) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={`flex items-center gap-3 rounded-2xl border-2 text-left transition ${
              compact ? 'p-2.5' : 'p-4'
            } ${active ? 'border-brand bg-brand/10' : 'border-white/10 bg-black hover:border-white/30'}`}
          >
            <span
              className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-11 w-11' : 'h-14 w-14'} ${
                active ? 'bg-brand text-black' : 'border border-white/10 bg-black text-brand'
              }`}
            >
              <TaskIcon id={id} size={compact ? 26 : 34} />
            </span>
            <span className="min-w-0">
              <span className={`block font-bold leading-tight ${compact ? 'text-sm' : 'text-lg'}`}>{t(`task.${id}`)}</span>
              {!compact && <span className="block text-sm text-neutral-300">{t(`task.${id}.desc`)}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
