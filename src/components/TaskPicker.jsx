import { useEffect, useRef } from 'react';
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
  excavation: <path d="M4 14H44 M9 14L15 40H33L39 14 M18 26H30" {...STROKE} />,
  pool: <path d="M5 10H43V40H5Z M9 27 Q13 22 17 27 T25 27 T33 27 T41 27" {...STROKE} />,
  waterproofing: <path d="M24 5 C24 5 11 20 11 30 A13 13 0 0 0 37 30 C37 20 24 5 24 5Z M18 31 A6 6 0 0 0 24 37" {...STROKE} />,
  demolition: <path d="M7 12H29V23H7Z M29 17.5H42 M18 23V43 M34 30 L38 34 M38 28 L34 34" {...STROKE} />,
  electrical: <path d="M27 5 L11 27H23 L21 43 L37 21H25Z" {...STROKE} />,
  plumbing: <path d="M5 18H30 A8 8 0 0 1 38 26V43 M30 8V18 M23 8H37" {...STROKE} />,
};

export function TaskIcon({ id, size = 40 }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      {ICONS[id]}
    </svg>
  );
}

/**
 * The work types as a HORIZONTAL CAROUSEL (radio group): one row that scrolls under the thumb and snaps card by card, so the catalog can grow without
 * ever making the screen taller. Quiet cards: a soft fill, no outline; the selected one turns brand-tinted. Names wrap, nothing overflows the margins.
 */
export default function TaskPicker({ value, onChange, labelledBy }) {
  const { t } = useI18n();
  const active = useRef(null);
  // the chosen card starts centred (a project opened on "Piscinas" must not show the strip scrolled to the first card)
  useEffect(() => {
    active.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} data-testid="task-carousel" className="hide-scrollbar -mx-3 flex snap-x snap-mandatory space-x-4 overflow-x-auto px-3 py-4">
      {TASK_IDS.map((id) => {
        const on = value === id;
        return (
          <button
            key={id}
            ref={on ? active : null}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`task-${id}`}
            onClick={() => onChange(id)}
            className={`flex min-h-[88px] min-w-[140px] shrink-0 snap-center flex-col items-center justify-center gap-2 whitespace-normal rounded-2xl px-3 py-3 text-center text-sm leading-tight transition active:scale-95 active:opacity-70 ${
              on ? 'bg-brand/20 font-normal text-brand' : 'bg-white/5 font-light text-neutral-300'
            }`}
          >
            <TaskIcon id={id} size={28} />
            <span className="block w-full break-words">{t(`task.${id}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
