import { useI18n } from '../../lib/i18n.jsx';
import { hasHealthNotes } from '../../lib/workers.js';
import Nick from '../squadra/Nick.jsx';
import { Stars } from '../squadra/Stars.jsx';

/** Two letters for an avatar: first letter of the first and of the last word. */
export const initialsOf = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (w) => (w ? Array.from(w)[0] : '');
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '')).toUpperCase() || '?';
};

/**
 * The live suggestions of the OMNIBOX of the crew, built to DROP UP: the container that holds them (CrewBlock, `absolute bottom-full`) grows
 * from the search field towards the free space ABOVE it, away from the keyboard. So the rows are laid out bottom-up (`flex-col-reverse`):
 * the DOM keeps the ranking (nearest, best rated first, which is also the reading order of a screen reader) but the best match is the row
 * touching the field, and the label / notes sit at the top of the panel. Tapping a person of the company's global directory adds them to the job
 * at once. READ ONLY governance: a project only picks from the directory, there is no "+ create" here (new people are created in Settings).
 */
export default function CrewSuggest({ rows, hint, placed, hidden, range, onPick }) {
  const { t } = useI18n();
  return (
    <section aria-label={t('ws.crew.fromDirectory')} data-testid="crew-suggest" className="row-fade flex flex-col-reverse">
      {rows.length > 0 && (
        <ul data-testid="crew-directory" className="flex flex-col-reverse">
          {rows.map(({ worker: w, near }) => (
            <li key={w.id} className="border-b border-white/5">
              <button type="button" onClick={() => onPick(w)} data-testid={`crew-pick-${w.id}`} data-near={near} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left transition active:bg-white/5">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-neutral-400">
                  {initialsOf(w.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-base font-medium text-neutral-200">
                      <span data-testid="crew-pick-name">{w.name}</span>
                      <Nick apodo={w.apodo} testId="crew-pick-apodo" />
                    </span>
                    {hasHealthNotes(w) && (
                      <span role="img" aria-label={t('squadra.healthFlag')} data-testid="crew-pick-health" className="shrink-0 text-sm text-orange-400">
                        ⚠
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-xs text-neutral-500" data-testid="crew-pick-note">
                      {[w.specialties[0] ? t(`ws.spec.${w.specialties[0]}`) : '', near === 0 ? t('crew.near.local') : near === 1 ? t('crew.near.regional') : ''].filter(Boolean).join(' · ')}
                    </span>
                    <Stars value={w.rating} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint && (
        <p className="px-1 py-3 text-center text-sm text-neutral-400" data-testid="crew-pick-hint">
          {hint}
        </p>
      )}
      {!placed && (
        <p className="px-1 py-1 text-xs text-neutral-500" data-testid="crew-noplace">
          {t('crew.pick.noPlace')}
        </p>
      )}
      {placed && range !== 'all' && hidden > 0 && (
        <p className="px-1 py-1 text-xs text-neutral-500" data-testid="crew-hidden">
          {t('crew.pick.noAddr', { n: hidden })}
        </p>
      )}
      <p className="px-1 text-xs font-medium text-neutral-500">{t('ws.crew.fromDirectory')}</p>
    </section>
  );
}
