import { useI18n } from '../../lib/i18n.jsx';
import { RATINGS } from '../../lib/workers.js';

const Star = ({ filled, size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" focusable="false" className={filled ? 'text-amber-400' : 'text-neutral-500'}>
    <path d="M12 2.8l2.85 5.95 6.4.85-4.7 4.45 1.2 6.45L12 17.3l-5.75 3.2 1.2-6.45-4.7-4.45 6.4-.85z" />
  </svg>
);

/** Read-only 1..5 stars (filled amber up to `value`). Announced as one image: "3 de 5". */
export function Stars({ value = 0, size = 14 }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t('squadra.ratingN', { n: value })} data-testid="stars" data-rating={value}>
      {RATINGS.map((n) => (
        <Star key={n} filled={n <= value} size={size} />
      ))}
    </span>
  );
}

/** The 1..5 picker of the worker's file: five 44 px targets; tapping the star that is already the rating clears it (0 = not rated). */
export function StarPicker({ value, onChange }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t('squadra.rating')} className="flex items-center" data-testid="worker-rating" data-rating={value}>
      {RATINGS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t('squadra.ratingN', { n })}
          onClick={() => onChange(value === n ? 0 : n)}
          data-testid={`worker-star-${n}`}
          className="flex h-11 w-11 items-center justify-center"
        >
          <Star filled={n <= value} size={28} />
        </button>
      ))}
    </div>
  );
}
