import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CREW_LIMIT, LEDGER_LIMITS, WORKER_SPECIALTIES, advancesByWorker, laborPool } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { hasHealthNotes, isBirthdayToday, loadWorkers } from '../../lib/workers.js';
import { withAdvance, withWorker, withWorkerEdited, withoutAdvance, withoutWorker } from '../../lib/workspaceModel.js';
import BottomSheet from '../BottomSheet.jsx';
import { EditToggle, RowDelete } from '../EditControls.jsx';
import BirthdayMark from '../squadra/BirthdayMark.jsx';
import { TextField } from '../ui.jsx';
import Block from './Block.jsx';
import { CREW_RANGES, DEFAULT_RANGE, LOCAL_KM, crewHealth, norm, omniMatch, rankWorkers } from '../../lib/crewMatch.js';
import { useKeyboardFit } from '../../lib/keyboardFit.js';
import CrewSuggest, { initialsOf } from './CrewSuggest.jsx';
import NumberPad from './NumberPad.jsx';
import { CoinsIcon, Outline, UsersIcon } from './icons.jsx';

/**
 * IN-SITU EMERGENCY PANEL (read only), at the very top of a person's sheet: the limiting conditions, allergies and emergency contact written in
 * their file of the directory, so nobody has to leave the job to read them in an emergency. Only rendered when the person carries a health warning.
 * If the file was deleted from the directory the warning still stands, but its details cannot be shown (and it says so).
 */
function EmergencyPanel({ file }) {
  const { t } = useI18n();
  const phone = (file?.emergencyPhone ?? '').replace(/[^0-9+]/g, '');
  const line = (id, label, value) =>
    value ? (
      <div data-testid={`crew-emergency-${id}`}>
        <dt className="text-xs font-medium uppercase text-orange-300">{label}</dt>
        <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-neutral-200">{value}</dd>
      </div>
    ) : null;
  return (
    <section role="region" aria-label={t('crew.emergency.title')} data-testid="crew-emergency" className="mb-4 mt-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-medium text-orange-300">
          <span aria-hidden="true" className="text-lg leading-none text-orange-500">
            ⚠
          </span>
          {t('crew.emergency.title')}
        </h3>
        {/* the blood group first and BIG: a paramedic reads it in a glance */}
        {file?.bloodType && (
          <span data-testid="crew-emergency-blood" role="img" aria-label={`${t('squadra.blood')}: ${file.bloodType}`} className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-0.5 text-2xl font-semibold leading-tight text-red-500">
            {file.bloodType}
          </span>
        )}
      </div>
      {file && !file.bloodType && (
        <p className="mt-2 text-xs text-neutral-400" data-testid="crew-emergency-blood-none">
          {t('squadra.blood')}: {t('squadra.blood.none').toLowerCase()}
        </p>
      )}
      {!file ? (
        <p className="mt-2 text-sm text-neutral-300" data-testid="crew-emergency-gone">
          {t('crew.emergency.gone')}
        </p>
      ) : (
        <dl className="mt-2 space-y-3">
          {line('limiting', t('squadra.limiting'), file.limiting)}
          {line('allergies', t('squadra.allergies'), file.allergies)}
          {file.emergencyName || file.emergencyPhone ? (
            <div data-testid="crew-emergency-contact">
              <dt className="text-xs font-medium uppercase text-orange-300">{t('squadra.emName')}</dt>
              <dd className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-neutral-200">
                <span className="min-w-0 break-words" data-testid="crew-emergency-contact-name">
                  {file.emergencyName}
                </span>
                {phone && (
                  <a href={`tel:${phone}`} data-testid="crew-emergency-phone" className="inline-flex min-h-[44px] items-center rounded-lg border border-orange-500/30 px-3 tabular-nums text-orange-300">
                    {file.emergencyPhone}
                  </a>
                )}
              </dd>
            </div>
          ) : (
            <p className="text-sm text-neutral-400" data-testid="crew-emergency-nocontact">
              {t('crew.emergency.noContact')}
            </p>
          )}
        </dl>
      )}
    </section>
  );
}

/** EDIT one person of the crew: name, specialty (closed list) and an optional line of tasks or notes. (Adding is the master search of the crew.) */
function WorkerSheet({ worker, file = null, health = false, onSave, onDelete, onClose }) {
  const { t } = useI18n();
  const [name, setName] = useState(worker?.name ?? '');
  const [specialty, setSpecialty] = useState(worker?.specialty ?? 'multi');
  const [notes, setNotes] = useState(worker?.notes ?? '');
  const specId = useId();
  const ready = name.trim().length > 0;
  return (
    <BottomSheet title={worker ? t('ws.crew.sheetEdit') : t('ws.crew.sheetNew')} onClose={onClose}>
      {health && <EmergencyPanel file={file} />}
      <form
        className="mt-3 space-y-4"
        data-testid="worker-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSave({ name, specialty, notes });
        }}
      >
        <TextField label={t('ws.crew.name')} value={name} onChange={setName} sanitize={(v) => sanitizeText(v, 60)} maxLength={60} testId="crew-name" />
        <div>
          <label className="label" htmlFor={specId}>
            {t('ws.crew.specialty')}
          </label>
          <select id={specId} value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="field-input min-h-[52px]" data-testid="crew-specialty">
            {WORKER_SPECIALTIES.map((s) => (
              <option key={s} value={s}>
                {t(`ws.spec.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <TextField label={t('ws.crew.notes')} optional={t('common.optional')} value={notes} onChange={setNotes} sanitize={(v) => sanitizeText(v, 120)} maxLength={120} testId="crew-notes" />
        <button type="submit" disabled={!ready} data-testid="crew-save" className="min-h-[56px] w-full rounded-xl px-3 text-base disabled:opacity-40 bg-brand text-black font-semibold hover:bg-brand-light">
          {t('ws.crew.save')}
        </button>
        {worker && (
          <div className="space-y-1">
            <button type="button" onClick={onDelete} data-testid="crew-delete" className="min-h-[52px] w-full rounded-xl border border-red-500/40 px-3 text-sm font-medium text-red-400 active:border-red-400">
              {t('common.delete')}
            </button>
            <p className="text-center text-xs text-neutral-400">{t('ws.crew.deleteNote')}</p>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}

/** ONE look for the chips of the crew (the distance ones): matte, quiet, the active one a little lighter. */
const chipClass = (active) => `min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition ${active ? 'bg-white/10 text-neutral-100' : 'bg-white/5 text-neutral-400'}`;
const specOf = (w) => (WORKER_SPECIALTIES.includes(w.specialty) ? w.specialty : 'multi');

/** The magnifier of the search field (local, outline: the shared icon set stays frozen). */
const SearchIcon = (props) => (
  <Outline size={18} icon="search" {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Outline>
);

/**
 * One person as a CONTACT of the agenda (WhatsApp / Phone style), no box: a continuous row with a hairline under it. Left an avatar with
 * the initials, in the middle the name (birthday cake, orange health triangle) and the trade under it, on the right the total already
 * advanced (quiet) and a discreet coin. Tapping the row, or the coin, UNFOLDS it (accordion, one at a time): the dated list of the
 * advances and two text actions without a frame, "+ Advance" (the app's numpad) and "Edit" (the worker's sheet). In EDIT MODE (the pencil
 * of the sheet's header) the row also wears its delete icon on the left and each advance of the unfolded detail its own cross.
 */
function WorkerCard({ row, health = false, birthday = false, editing = false, expanded = false, onToggle, onEdit, onAdvance, onRemove, onRemoveAdvance }) {
  const { t, money, locale } = useI18n();
  const { worker: w, list, total } = row;
  const panelId = `worker-panel-${w.id}`;
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  return (
    <li className="border-b border-white/5" data-testid={`worker-${w.id}`} data-specialty={w.specialty}>
      <div className="flex items-center gap-1">
        {editing && <RowDelete name={w.name} testId={`worker-del-${w.id}`} onConfirm={onRemove} />}
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId} data-testid={`worker-toggle-${w.id}`} aria-label={`${w.name}${health ? ` · ⚠ ${t('squadra.healthFlag')}` : ''}${total > 0 ? ` · ${t('ws.crew.advanced')}: ${money(total)}` : ''}`} className={`flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-2 text-left ${editing ? 'pl-1' : ''}`}>
          <span aria-hidden="true" data-testid={`worker-avatar-${w.id}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-sm font-medium text-neutral-400">
            {initialsOf(w.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate text-base font-medium text-neutral-200" data-testid={`worker-name-${w.id}`}>
                {w.name}
              </span>
              {birthday && <BirthdayMark testId={`worker-birthday-${w.id}`} />}
              {/* safety: the warning of the worker's file (limiting condition / allergy) stays on the row for as long as they are on the job */}
              {health && (
                <span role="img" aria-label={t('squadra.healthFlag')} title={t('squadra.healthFlag')} data-testid={`worker-health-${w.id}`} className="shrink-0 text-lg leading-none text-orange-500">
                  ⚠
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-neutral-500" data-testid={`worker-role-${w.id}`}>
              {t(`ws.spec.${specOf(w)}`)}
            </span>
          </span>
          {total > 0 && (
            <span className="shrink-0 pl-2 text-xs font-medium tabular-nums text-neutral-400" data-testid={`worker-total-${w.id}`} data-total={total}>
              {money(total)}
            </span>
          )}
        </button>
        {/* the payment: a coin, no frame. It does the same as the row: unfolds the detail of the advances */}
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId} aria-label={`${t('ws.crew.advanced')}: ${w.name}`} title={t('ws.crew.advanced')} data-testid={`worker-pay-${w.id}`} className={`flex h-11 w-11 shrink-0 items-center justify-center transition ${expanded ? 'text-emerald-400' : 'text-neutral-400'}`}>
          <CoinsIcon size={22} />
        </button>
      </div>
      {expanded && (
        <div className="acc-open" id={panelId} data-testid={`worker-detail-${w.id}`}>
          <div className="min-h-0 overflow-hidden">
            <div className="pb-2 pl-[3.25rem] pr-1">
              <p className="text-xs font-medium text-neutral-500">{t('ws.crew.advanced')}</p>
              {list.length === 0 && <p className="mt-0.5 text-xs font-medium text-neutral-500">{t('ws.crew.noAdvances')}</p>}
              {list.length > 0 && (
                <ul className="mt-0.5 divide-y divide-white/5" data-testid={`worker-advlist-${w.id}`}>
                  {list.map((a) => (
                    <li key={a.id} className="flex min-h-[36px] items-center gap-3">
                      <span className="min-w-0 flex-1 text-xs font-medium text-neutral-500">{stamp(a.at)}</span>
                      <span className="text-xs font-medium tabular-nums text-neutral-300">{money(a.amount)}</span>
                      {editing && (
                        <button type="button" onClick={() => onRemoveAdvance(a.id)} aria-label={`${t('common.delete')}: ${w.name}`} data-testid={`worker-adv-del-${a.id}`} className="row-fade flex h-9 w-9 shrink-0 items-center justify-center text-base text-red-400/80 hover:text-red-400">
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 flex items-center gap-5">
                <button type="button" onClick={onAdvance} data-testid={`worker-adv-${w.id}`} className="min-h-[44px] text-sm font-medium text-emerald-400 transition active:text-emerald-300">
                  + {t('ws.crew.advance')}
                </button>
                <button type="button" onClick={onEdit} data-testid={`worker-edit-${w.id}`} className="min-h-[44px] text-sm text-neutral-400 transition active:text-neutral-200">
                  {t('ws.crew.sheetEdit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * ZONE B, "Squadra": ONLY the people (the schedule lives in its own module, TimelineBlock). The crew is a NOMINAL list of the people physically
 * on site, found and added from ONE master search. Cash advances are handed to a person (their card has the "+ Anticipo"
 * button, which opens the app's numpad); every advance is still one entry of `project.advances`, so the labour pool and the project's
 * cash (ledger.js) keep adding all of them. Nothing here is a theoretical estimate any more (no man-hours, no dead days, no bars).
 */
export default function CrewBlock({ project, result, setProject, open, onToggle }) {
  const { t, money, region } = useI18n();
  const [sheet, setSheet] = useState(null); // null | worker id (the sheet that edits one person)
  const [editMode, setEditMode] = useState(false); // the pencil of the header: the delete icons only exist while it is on
  const [advFor, setAdvFor] = useState(null); // worker id whose advance is being typed on the pad
  const [unfolded, setUnfolded] = useState(null); // accordion: the id of the ONE unfolded row (null = all folded)
  const [query, setQuery] = useState(''); // the search field of the agenda
  const [searching, setSearching] = useState(false); // the omnibox has the focus: the keyboard is up and the results take the room that is left
  const [range, setRange] = useState(DEFAULT_RANGE); // the distance chip: it only reaches the suggestions of the company's directory
  const amount = useRef(0);
  const results = useRef(null); // the results block (suggestions + crew): flex-1, its own scroll
  const searchBox = useRef(null);
  useKeyboardFit(results, searching);
  const crew = project.crew ?? [];
  const { rows, loose, looseTotal } = advancesByWorker(crew, project.advances);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const editing = sheet ? crew.find((w) => w.id === sheet) : null;
  // the directory is read again whenever a sheet opens or closes and whenever a search starts (its files may have just been edited in Settings)
  const directory = useMemo(() => loadWorkers(), [sheet, open, query.trim() !== '']); // eslint-disable-line react-hooks/exhaustive-deps
  // THE OMNIBOX: ONE field. Every typed word is looked for at once in the first name, the surname and the trade, both among the crew on the job
  // and among the company's directory ("ele" finds Elena and Juan the electrician). Read only governance: a project never creates people.
  const typed = query.trim();
  const visible = rows.filter((r) => !typed || omniMatch(typed, [r.worker.name, t(`ws.spec.${specOf(r.worker)}`)]));
  const crewFull = crew.length >= CREW_LIMIT;
  const suggesting = !crewFull && typed !== '';
  const inProject = (w) => crew.some((c) => c.ref === w.id || norm(c.name) === norm(w.name));
  const rankFor = (reach) => rankWorkers(directory, { project, range: reach, query: typed, label: (id) => t(`ws.spec.${id}`) });
  const ranked = useMemo(
    () => (suggesting ? rankFor(range) : { rows: [], placed: true, hidden: 0 }),
    [suggesting, directory, project, range, typed, t], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const suggestions = ranked.rows.filter(({ worker }) => !inProject(worker));
  // nobody in this reach but somebody in a wider one: say so; nobody at all: the passive "no results, new people are created in Settings"
  const widerHas = suggesting && suggestions.length === 0 && directory.length > 0 && range !== 'all' && rankFor('all').rows.some(({ worker }) => !inProject(worker));
  const suggestHint = !directory.length ? t('crew.pick.noDir') : suggestions.length === 0 ? (widerHas ? t('crew.pick.noRange') : t('crew.pick.noMatch')) : '';
  const addPerson = (w) => {
    if (inProject(w) || crewFull) return;
    setProject((p) => withWorker(p, { name: w.name, specialty: w.specialties[0] || 'multi', ref: w.id, health: hasHealthNotes(w) }));
    setQuery('');
  };
  const healthOf = (w) => crewHealth(w, directory);
  const birthdayOf = (w) => isBirthdayToday(directory.find((f) => f.id === w.ref)?.birthDate); // local date of the device, plain-text people have no file

  const closeAdvance = () => {
    const n = amount.current;
    amount.current = 0;
    if (advFor && n > 0) setProject((p) => withAdvance(p, advFor, n));
    setAdvFor(null);
  };
  const advanceFull = (project.advances ?? []).length >= LEDGER_LIMITS.advances;
  const nothingToEdit = crew.length === 0 && loose.length === 0;
  // the sheet closed (device Back, swipe, backdrop) or nothing left to edit: back to the quiet, protected state
  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setUnfolded(null);
      setQuery('');
      setSearching(false);
      setRange(DEFAULT_RANGE);
    }
  }, [open]);
  useEffect(() => {
    if (editMode && nothingToEdit) setEditMode(false);
  }, [editMode, nothingToEdit]);

  // the pencil REPLACES the x of the header: the sheet closes only the native way (device Back, swipe down, backdrop, Escape)
  const editToggle = (
    <EditToggle
      active={editMode}
      onToggle={() => {
        setEditMode((v) => !v);
      }}
      disabled={nothingToEdit}
      label={t('crew.edit.on')}
      doneLabel={t('crew.edit.done')}
      testId="crew-edit-toggle"
    />
  );

  return (
    <Block icon={<UsersIcon size={32} />} label={t('ws.menu.crew')} id="crew" title={t('ws.crew.title')} meta={t(crew.length === 1 ? 'ws.crew.count1' : 'ws.crew.countN', { n: crew.length })} open={open} onToggle={onToggle} testId="ws-crew" tall fill headerAction={editToggle}>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {/* the labour balance is read BEFORE handing out an advance; then, the OMNIBOX: the distance chips right ABOVE the search field, and the results
            block BORN under it (flex-1, its own scroll, kept above the keyboard while the field has the focus). No trade chips, no "+ create" here. */}
        <div className="shrink-0 space-y-2">
          <div className="flex items-center gap-3" data-testid="crew-bar">
            <p data-testid="labor-pool" data-available={pool.available} data-spent={pool.advanced} className="min-w-0 flex-1 text-right text-sm text-neutral-300">
              {t('ws.crew.labor')}: <b className="tabular-nums text-neutral-200">{money(pool.available)}</b>
              <span className="whitespace-nowrap tabular-nums text-[#e8c35f]"> ({t('ws.crew.spent')}: {money(pool.advanced)})</span>
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              searchBox.current?.blur(); // "done": the keyboard goes down, the results stay
            }}
            data-testid="crew-master"
            className="space-y-2"
          >
            {directory.length > 0 && (
              <div role="radiogroup" aria-label={t('crew.pick.range')} data-testid="crew-range" className="hide-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-0.5">
                {CREW_RANGES.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)} data-testid={`crew-range-${r}`} className={chipClass(range === r)}>
                    {t(`crew.range.${r}`, { km: LOCAL_KM })}
                  </button>
                ))}
              </div>
            )}
            <div className="relative" data-testid="crew-search-box">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                ref={searchBox}
                type="search"
                value={query}
                onChange={(e) => setQuery(sanitizeText(e.target.value, 60))}
                onFocus={() => setSearching(true)}
                onBlur={() => setSearching(false)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || !query) return;
                  e.preventDefault();
                  e.stopPropagation(); // clears the search only; the sheet underneath stays open
                  setQuery('');
                }}
                maxLength={60}
                placeholder={t('ws.crew.search')}
                aria-label={t('ws.crew.search')}
                autoComplete="off"
                enterKeyHint="done"
                data-testid="crew-search"
                className="min-h-[44px] w-full rounded-xl border-0 bg-neutral-900/50 pl-10 pr-4 text-base text-neutral-100 outline-none placeholder:text-neutral-500 focus:bg-white/5"
              />
            </div>
          </form>
        </div>
        <div ref={results} data-testid="crew-results" data-searching={searching ? 'true' : undefined} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
          {suggesting && <CrewSuggest rows={suggestions} hint={suggestHint} placed={ranked.placed || directory.length === 0} hidden={ranked.hidden} range={range} onPick={addPerson} />}
          {crew.length === 0 && !typed && (
            <p className="text-sm text-neutral-400" data-testid="crew-empty">
              {t('ws.crew.empty')}
            </p>
          )}
          {crew.length > 0 && visible.length === 0 && !typed && (
            <p className="py-3 text-center text-sm text-neutral-400" data-testid="crew-nomatch">
              {t('ws.crew.noMatch')}
            </p>
          )}
          {visible.length > 0 && (
            <ul data-testid="crew-list">
              {visible.map((row) => (
                <WorkerCard
                  key={row.worker.id}
                  row={row}
                  health={healthOf(row.worker)}
                  birthday={birthdayOf(row.worker)}
                  editing={editMode}
                  expanded={unfolded === row.worker.id}
                  onToggle={() => setUnfolded((id) => (id === row.worker.id ? null : row.worker.id))}
                  onEdit={() => setSheet(row.worker.id)}
                  onRemove={() => setProject((p) => withoutWorker(p, row.worker.id))}
                  onAdvance={() => {
                    if (advanceFull) return;
                    amount.current = 0;
                    setAdvFor(row.worker.id);
                  }}
                  onRemoveAdvance={(id) => setProject((p) => withoutAdvance(p, id))}
                />
              ))}
            </ul>
          )}
          {loose.length > 0 && (
          <div className="space-y-1" data-testid="advances-loose" data-total={looseTotal}>
            <p className="flex justify-between text-xs font-semibold text-neutral-400">
              <span>{t('ws.crew.loose')}</span>
              <span className="tabular-nums">{money(looseTotal)}</span>
            </p>
            <ul className="divide-y divide-white/10">
              {loose.map((a) => (
                <li key={a.id} className="flex min-h-[44px] items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{a.worker}</span>
                  <span className="text-sm font-medium tabular-nums">{money(a.amount)}</span>
                  {editMode && (
                    <button type="button" onClick={() => setProject((p) => withoutAdvance(p, a.id))} aria-label={`${t('common.delete')}: ${a.worker}`} data-testid={`worker-adv-del-${a.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400/80 hover:text-red-400">
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          )}
        </div>
      </div>

      {editing && (
        <WorkerSheet
          worker={editing}
          file={directory.find((f) => f.id === editing.ref) ?? null}
          health={healthOf(editing) || Boolean(directory.find((f) => f.id === editing.ref)?.bloodType)} // the blood group is medical data too: it opens the panel on its own
          onClose={() => setSheet(null)}
          onSave={(data) => {
            setProject((p) => withWorkerEdited(p, editing.id, { ...data, ref: editing.ref, health: editing.health }));
            setSheet(null);
          }}
          onDelete={() => {
            setProject((p) => withoutWorker(p, editing.id));
            setSheet(null);
          }}
        />
      )}
      {advFor && (
        <NumberPad
          testId="advance-pad"
          title={`${t('ws.adv.pad')} · ${crew.find((w) => w.id === advFor)?.name ?? ''}`}
          unit={region.currency}
          value={null}
          decimals={region.digits}
          onChange={(n) => {
            amount.current = n;
          }}
          onEmpty={() => {
            amount.current = 0;
          }}
          onClose={closeAdvance}
        />
      )}
    </Block>
  );
}
