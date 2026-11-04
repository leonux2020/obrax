import { useId, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CREW_RANGES, DEFAULT_RANGE, LOCAL_KM, findByName, norm, rankWorkers } from '../../lib/crewMatch.js';
import { WORKER_SPECIALTIES } from '../../lib/ledger.js';
import { sanitizeTextInput } from '../../lib/sanitize.js';
import { hasHealthNotes, loadWorkers } from '../../lib/workers.js';
import { Stars } from '../squadra/Stars.jsx';

/**
 * The hybrid selector to add a person to a job ("fast-track"), as an INLINE DROPDOWN under the control line of the crew (no stacked modal).
 *   1. DIRECTORY: the global directory (Squadra) below, filtered by the typed text, a trade chip and a range, nearest and best rated first.
 *      Tapping a row adds that worker at once (linked to their file) to the list underneath and the dropdown folds away.
 *   2. URGENCY: whatever is typed can be added as plain text with the button that appears under the field: no medical file is asked for.
 * Range: "Local (< 70 km)" by default (short trips, less stress), "Regional" and "Todos" one tap away. The trade chip also becomes the
 * specialty of a person added as plain text.
 */
export default function CrewPicker({ project, crew, onAdd, onClose }) {
  const { t } = useI18n();
  const nameId = useId();
  const [workers] = useState(() => loadWorkers());
  const [text, setText] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [range, setRange] = useState(DEFAULT_RANGE);
  const { rows, placed, hidden } = useMemo(() => rankWorkers(workers, { project, specialty, range, query: text }), [workers, project, specialty, range, text]);
  const inProject = (w) => crew.some((c) => c.ref === w.id || norm(c.name) === norm(w.name));
  const typed = text.trim();

  const addDirectory = (w) => {
    if (inProject(w)) return;
    onAdd({ name: w.name, specialty: specialty || w.specialties[0] || 'multi', ref: w.id, health: hasHealthNotes(w) });
  };
  const addText = (e) => {
    e.preventDefault();
    if (!typed) return;
    const match = findByName(workers, typed); // typing the exact name of someone in the directory links their file
    if (match && !inProject(match)) onAdd({ name: match.name, specialty: specialty || match.specialties[0] || 'multi', ref: match.id, health: hasHealthNotes(match) });
    else onAdd({ name: typed, specialty: specialty || 'multi' }); // simple text, like always
  };

  const empty = rows.length === 0;
  const hint = !workers.length ? t('crew.pick.noDir') : empty ? (typed ? t('crew.pick.noMatch') : t('crew.pick.noRange')) : '';

  return (
    <section
      aria-label={t('ws.crew.sheetNew')}
      data-testid="crew-selector"
      className="rounded-xl border border-white/10 bg-black p-3"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation(); // folds the dropdown only; the sheet underneath stays open
        onClose();
      }}
    >
      <form className="space-y-3" data-testid="worker-form" onSubmit={addText}>
        <div>
          <label className="label" htmlFor={nameId}>
            {t('crew.pick.name')}
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="off"
            maxLength={60}
            value={text}
            placeholder={t('crew.pick.ph')}
            onChange={(e) => setText(sanitizeTextInput(e.target.value, 60))}
            data-testid="crew-name"
            className="field-input"
          />
        </div>
        {/* flow 2, urgency: whatever is typed goes in as plain text; no file is asked for (the button only exists once something is typed) */}
        {typed && (
          <button type="submit" data-testid="crew-save" className="min-h-[52px] w-full rounded-xl px-3 text-base bg-brand text-black font-semibold hover:bg-brand-light">
            {t('crew.pick.add', { name: typed })}
          </button>
        )}

        {/* trades: a horizontally scrolling row; one tap filters the list at once, another tap clears it */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="crew-filters" role="group" aria-label={t('crew.pick.filter')}>
          <div className="flex w-max gap-2 pb-1">
            {WORKER_SPECIALTIES.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={specialty === id}
                onClick={() => setSpecialty(specialty === id ? '' : id)}
                data-testid={`crew-filter-${id}`}
                className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-4 text-sm transition ${specialty === id ? 'border-brand text-brand' : 'border-white/10 text-neutral-300'}`}
              >
                {t(`ws.spec.${id}`)}
              </button>
            ))}
          </div>
        </div>

        {/* reach: three quiet chips, "Local" (the radius that cares for the trips) on by default */}
        <div role="radiogroup" aria-label={t('crew.pick.range')} className="grid grid-cols-3 gap-2" data-testid="crew-range">
          {CREW_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              onClick={() => setRange(r)}
              data-testid={`crew-range-${r}`}
              className={`min-h-[44px] rounded-lg border px-2 text-xs transition ${range === r ? 'border-brand text-brand' : 'border-white/10 text-neutral-400'}`}
            >
              {t(`crew.range.${r}`, { km: LOCAL_KM })}
            </button>
          ))}
        </div>
        {!placed && workers.length > 0 && (
          <p className="-mt-2 text-xs text-neutral-400" data-testid="crew-noplace">
            {t('crew.pick.noPlace')}
          </p>
        )}
        {placed && range !== 'all' && hidden > 0 && (
          <p className="-mt-2 text-xs text-neutral-400" data-testid="crew-hidden">
            {t('crew.pick.noAddr', { n: hidden })}
          </p>
        )}

        {hint && (
          <p className="text-sm text-neutral-400" data-testid="crew-pick-hint">
            {hint}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="max-h-72 space-y-2 overflow-y-auto overscroll-contain" data-testid="crew-directory">
            {rows.map(({ worker: w, near }) => {
              const added = inProject(w);
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => addDirectory(w)}
                    data-testid={`crew-pick-${w.id}`}
                    data-near={near}
                    className="block min-h-[64px] w-full rounded-xl border border-white/10 px-4 py-3 text-left transition active:border-white/40 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-base font-medium text-neutral-200" data-testid="crew-pick-name">
                        {w.name}
                      </span>
                      {hasHealthNotes(w) && (
                        <span role="img" aria-label={t('squadra.healthFlag')} data-testid="crew-pick-health" className="shrink-0 text-sm text-orange-400">
                          ⚠
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <Stars value={w.rating} />
                      <span className="text-xs text-neutral-400" data-testid="crew-pick-note">
                        {added ? t('crew.pick.inProject') : near === 0 ? t('crew.near.local') : near === 1 ? t('crew.near.regional') : ''}
                      </span>
                    </span>
                    {w.specialties.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {w.specialties.slice(0, 3).map((s) => (
                          <span key={s} data-testid="crew-pick-chip" className="rounded-full px-2 py-0.5 text-xs bg-neutral-800 text-neutral-300">
                            {t(`ws.spec.${s}`)}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </form>
    </section>
  );
}
