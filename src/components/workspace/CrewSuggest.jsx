import { useI18n } from '../../lib/i18n.jsx';
import { norm } from '../../lib/crewMatch.js';
import { hasHealthNotes } from '../../lib/workers.js';
import Nick from '../squadra/Nick.jsx';
import { Stars } from '../squadra/Stars.jsx';

/** Two letters for an avatar: first letter of the first and of the last word. */
export const initialsOf = (name) => {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (w) => (w ? Array.from(w)[0] : '');
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '')).toUpperCase() || '?';
};

/** `Juan “El Flaco” Pérez`: the nickname sits BETWEEN the first name and the rest; one word names just get it after. */
export const nameParts = (name) => {
  const text = String(name ?? '').trim();
  const at = text.search(/\s/);
  return at < 0 ? { first: text, rest: '' } : { first: text.slice(0, at), rest: text.slice(at).trim() };
};

/** The trade ids of a worker, the ones the typed words are looking for FIRST (typing "electri" must show the electrician trade of a person who is also a painter). */
export const tradesFor = (worker, query, label) => {
  const ids = Array.isArray(worker?.specialties) ? worker.specialties : [];
  const words = norm(query).split(' ').filter(Boolean);
  const hit = (id) => words.some((w) => norm(label(id)).includes(w));
  return [...ids.filter(hit), ...ids.filter((id) => !hit(id))];
};

/** The distance as words: "Local (12 km)", "Regional (130 km)", "420 km", "Local" when only the town name says so; '' when nothing is known. */
export const distanceText = (t, near, km) => {
  const label = near === 0 ? t('crew.near.local') : near === 1 ? t('crew.near.regional') : '';
  const kms = Number.isFinite(km) ? `${Math.max(1, Math.round(km))} km` : '';
  return label && kms ? `${label} (${kms})` : label || kms;
};

function Line2({ worker, near, km, unknown, query }) {
  const { t } = useI18n();
  const trades = tradesFor(worker, query, (id) => t(`ws.spec.${id}`));
  const trade = trades[0] ? t(`ws.spec.${trades[0]}`) : '';
  const more = trades.length - 1;
  const dist = distanceText(t, near, km);
  const far = unknown ? t('crew.near.unknown') : '';
  const hasDistance = Boolean(dist || far);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {(trade || hasDistance) && (
        <span className="flex min-w-0 flex-1 items-center text-sm" data-testid="crew-pick-note">
          {trade && (
            <span className="min-w-0 truncate font-medium text-brand/90" data-testid="crew-pick-specialty">
              {trade}
              {more > 0 && <span className="font-normal text-neutral-400" data-testid="crew-pick-more"> +{more}</span>}
            </span>
          )}
          {trade && hasDistance && (
            <span aria-hidden="true" className="shrink-0 px-1.5 text-neutral-500">
              {' · '}
            </span>
          )}
          {dist && (
            <span className="max-w-[60%] shrink-0 truncate whitespace-nowrap text-neutral-300" data-testid="crew-pick-distance">
              {dist}
            </span>
          )}
          {far && (
            <span className="max-w-[60%] shrink-0 truncate whitespace-nowrap italic text-neutral-400" data-testid="crew-pick-unknown">
              {far}
            </span>
          )}
        </span>
      )}
      <span className="ml-auto shrink-0">
        <Stars value={worker.rating} />
      </span>
    </span>
  );
}

/**
 * The live suggestions of the OMNIBOX of the crew, built to DROP UP: the container that holds them (CrewBlock, `absolute bottom-full`) grows
 * from the search field towards the free space ABOVE it, away from the keyboard. So the rows are laid out bottom-up (`flex-col-reverse`):
 * the DOM keeps the ranking (nearest, best rated first, which is also the reading order of a screen reader) but the best match is the row
 * touching the field, and the label / notes sit at the top of the panel. Tapping a person of the company's global directory adds them to the job
 * at once. READ ONLY governance: a project only picks from the directory, there is no "+ create" here (new people are created in Settings).
 */
export default function CrewSuggest({ rows, hint, placed, hidden, range, onPick, query = '' }) {
  const { t } = useI18n();
  return (
    <section aria-label={t('ws.crew.fromDirectory')} data-testid="crew-suggest" className="row-fade flex flex-col-reverse">
      {rows.length > 0 && (
        <ul data-testid="crew-directory" className="flex flex-col-reverse">
          {rows.map(({ worker: w, near, km, unknown }) => (
            <li key={w.id} className="border-b border-white/5">
              <button type="button" onClick={() => onPick(w)} data-testid={`crew-pick-${w.id}`} data-near={near} data-unknown={unknown ? 'true' : undefined} className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left transition active:bg-white/5">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-neutral-400">
                  {initialsOf(w.name)}
                </span>
                <span className="min-w-0 flex-1">
                  {/* line 1: Name “Nickname” Surname */}
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-base font-medium text-neutral-100" data-testid="crew-pick-name">
                      {nameParts(w.name).first}
                      <Nick apodo={w.apodo} testId="crew-pick-apodo" />
                      {nameParts(w.name).rest && ` ${nameParts(w.name).rest}`}
                    </span>
                    {hasHealthNotes(w) && (
                      <span role="img" aria-label={t('squadra.healthFlag')} data-testid="crew-pick-health" className="shrink-0 text-sm text-orange-400">
                        ⚠
                      </span>
                    )}
                  </span>
                  {/* line 2: Trade · Distance. The trade leads (it is what tells two Juans apart); a missing part collapses with its separator */}
                  <Line2 worker={w} near={near} km={km} unknown={unknown} query={query} />
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
