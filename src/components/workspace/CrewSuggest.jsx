import { useI18n } from '../../lib/i18n.jsx';
import { hasHealthNotes } from '../../lib/workers.js';
import { Stars } from '../squadra/Stars.jsx';

/** Two letters for an avatar: first letter of the first and of the last word. */
export const initialsOf = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (w) => (w ? Array.from(w)[0] : '');
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '')).toUpperCase() || '?';
};

/**
 * The live suggestions of the OMNIBOX of the crew: a quiet strip of contact rows (no boxes, hairlines) that is born right under the search
 * field. It has no scroll of its own: it lives inside the results block of the sheet (`flex-1 overflow-y-auto`), which takes the visible space
 * that is left above the keyboard. Tapping a person of the company's global directory adds them to the job at once. READ ONLY governance: a project
 * can only pick from the directory, there is no "+ create" here (new people are created in Settings). `rows` already come ranked (nearest, best
 * rated) and without the people already on the job.
 */
export default function CrewSuggest({ rows, hint, placed, hidden, range, onPick }) {
  const { t } = useI18n();
  return (
    <section aria-label={t('ws.crew.fromDirectory')} data-testid="crew-suggest" className="row-fade">
      <p className="px-1 text-xs font-medium text-neutral-500">{t('ws.crew.fromDirectory')}</p>
      {rows.length > 0 && (
        <ul data-testid="crew-directory">
          {rows.map(({ worker: w, near }) => (
            <li key={w.id} className="border-b border-white/5">
              <button type="button" onClick={() => onPick(w)} data-testid={`crew-pick-${w.id}`} data-near={near} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left transition active:bg-white/5">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-neutral-400">
                  {initialsOf(w.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-base font-medium text-neutral-200" data-testid="crew-pick-name">
                      {w.name}
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
    </section>
  );
}
