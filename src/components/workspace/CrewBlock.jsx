import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CREW_LIMIT, LEDGER_LIMITS, WORKER_SPECIALTIES, advancesByWorker, laborPool } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { isBirthdayToday, loadWorkers } from '../../lib/workers.js';
import { calendarDays, withAdvance, withProjectDates, withWorker, withWorkerEdited, withoutAdvance, withoutWorker } from '../../lib/workspaceModel.js';
import BottomSheet from '../BottomSheet.jsx';
import { EditToggle, RowDelete } from '../EditControls.jsx';
import BirthdayMark from '../squadra/BirthdayMark.jsx';
import { DateInput, TextField } from '../ui.jsx';
import Block from './Block.jsx';
import { crewHealth } from '../../lib/crewMatch.js';
import CrewPicker from './CrewPicker.jsx';
import LockedZone from './LockedZone.jsx';
import NumberPad from './NumberPad.jsx';
import { CoinsIcon, UsersIcon } from './icons.jsx';

/**
 * The two job dates, typed by hand, as ONE minimalist pill on a single line: "📅 23/10/2026 ➔ 25/10/2026 (2 días)". Each date is a real
 * date field (the whole field opens the calendar) stripped of its box; the days between them are a plain subtraction, no estimate.
 */
function Dates({ project, setProject }) {
  const { t } = useI18n();
  const startId = useId();
  const endId = useId();
  const days = calendarDays(project);
  const bare = '!min-h-[40px] !w-[8.6rem] !rounded-lg !border-transparent !bg-transparent !px-1.5 !py-0 text-center text-sm tabular-nums';
  return (
    <div className="flex min-h-[48px] flex-wrap items-center justify-center gap-x-1 gap-y-0 rounded-full border border-white/10 px-3 py-1" data-testid="crew-dates">
      <span aria-hidden="true" className="text-base leading-none">
        📅
      </span>
      <label className="sr-only" htmlFor={startId}>
        {t('ws.crew.start')}
      </label>
      <DateInput id={startId} className={bare} value={project.startDate} onChange={(e) => setProject((p) => withProjectDates(p, { startDate: e.target.value }))} data-testid="crew-start" />
      <span aria-hidden="true" className="text-neutral-400">
        ➔
      </span>
      <label className="sr-only" htmlFor={endId}>
        {t('ws.crew.end')}
      </label>
      <DateInput id={endId} className={bare} value={project.endDate} min={project.startDate || undefined} onChange={(e) => setProject((p) => withProjectDates(p, { endDate: e.target.value }))} data-testid="crew-end" />
      <span className="text-sm tabular-nums text-neutral-300" data-testid="crew-duration" data-days={days ?? ''} aria-label={t('ws.crew.duration')}>
        ({days === null ? '—' : t(days === 1 ? 'ws.crew.day1' : 'ws.crew.dayN', { n: days })})
      </span>
    </div>
  );
}

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

/** EDIT one person of the crew: name, specialty (closed list) and an optional line of tasks or notes. (Adding is the hybrid CrewPicker.) */
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

/**
 * One person as a MINIMAL row: the name (tap it for their sheet), the birthday cake on the day, the orange health triangle, the total already
 * advanced to them (quiet, always visible, right next to the button: it is read BEFORE handing out more money) and the compact [coins Anticipo]
 * button, all on one line. In EDIT MODE (the pencil of the sheet's header) the row also wears its delete icon on the left and reveals the
 * detail of each advance (deletable) right under the line.
 */
function WorkerCard({ row, health = false, birthday = false, editing = false, onEdit, onAdvance, onRemove, onRemoveAdvance }) {
  const { t, money, locale } = useI18n();
  const { worker: w, list, total } = row;
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  return (
    <li className="rounded-xl border border-white/10 bg-black" data-testid={`worker-${w.id}`} data-specialty={w.specialty}>
      <div className="flex items-center gap-1 pr-2">
        {editing && <RowDelete name={w.name} testId={`worker-del-${w.id}`} onConfirm={onRemove} />}
        <button type="button" onClick={onEdit} data-testid={`worker-edit-${w.id}`} aria-label={`${t('ws.crew.sheetEdit')}: ${w.name}${health ? ` · ⚠ ${t('squadra.healthFlag')}` : ''}${total > 0 ? ` · ${t('ws.crew.advanced')}: ${money(total)}` : ''}`} className={`flex min-h-[56px] min-w-0 flex-1 items-center gap-2 py-1.5 text-left ${editing ? 'pl-1' : 'pl-4'}`}>
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
          {total > 0 && (
            <span className="ml-auto shrink-0 pl-2 text-xs font-medium tabular-nums text-neutral-400" data-testid={`worker-total-${w.id}`} data-total={total}>
              {money(total)}
            </span>
          )}
        </button>
        {/* the row's main action, compact and on the name's own line (OLED: black ground, coloured border + text) */}
        <button
          type="button"
          onClick={onAdvance}
          data-testid={`worker-adv-${w.id}`}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500 bg-black px-3 text-sm font-medium text-emerald-400 transition active:scale-[0.98] active:border-emerald-300"
        >
          <CoinsIcon size={20} />
          <span>{t('ws.crew.advance')}</span>
        </button>
      </div>
      {editing && (
        <div className="border-t border-white/5 px-4 py-1.5" data-testid={`worker-detail-${w.id}`}>
          <p className="text-xs font-medium text-neutral-500">{t('ws.crew.advanced')}</p>
          {list.length === 0 && <p className="text-xs font-medium text-neutral-500">{t('ws.crew.noAdvances')}</p>}
          {list.length > 0 && (
            <ul className="mt-0.5 divide-y divide-white/5" data-testid={`worker-advlist-${w.id}`}>
              {list.map((a) => (
                <li key={a.id} className="flex min-h-[36px] items-center gap-3">
                  <span className="min-w-0 flex-1 text-xs font-medium text-neutral-500">{stamp(a.at)}</span>
                  <span className="text-xs font-medium tabular-nums">{money(a.amount)}</span>
                  <button type="button" onClick={() => onRemoveAdvance(a.id)} aria-label={`${t('common.delete')}: ${w.name}`} data-testid={`worker-adv-del-${a.id}`} className="flex h-9 w-9 shrink-0 items-center justify-center text-base text-red-400/80 hover:text-red-400">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * ZONE B, "Squadra e cronoprogramma": the schedule is MANUAL (start date, delivery date, and the calendar days between them) and the
 * crew is a NOMINAL list of the people physically on site. Cash advances are handed to a person (their card has the "+ Anticipo"
 * button, which opens the app's numpad); every advance is still one entry of `project.advances`, so the labour pool and the project's
 * cash (ledger.js) keep adding all of them. Nothing here is a theoretical estimate any more (no man-hours, no dead days, no bars).
 */
export default function CrewBlock({ project, result, locked, onBlocked, setProject, open, onToggle }) {
  const { t, money, region } = useI18n();
  const [sheet, setSheet] = useState(null); // null | worker id (the sheet that edits one person)
  const [picking, setPicking] = useState(false); // the inline dropdown to add people
  const [editMode, setEditMode] = useState(false); // the pencil of the header: the delete icons only exist while it is on
  const [advFor, setAdvFor] = useState(null); // worker id whose advance is being typed on the pad
  const amount = useRef(0);
  const crew = project.crew ?? [];
  const { rows, loose, looseTotal } = advancesByWorker(crew, project.advances);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const days = calendarDays(project);
  const editing = sheet ? crew.find((w) => w.id === sheet) : null;
  // the directory is read again whenever a sheet or the dropdown opens or closes (its file may have just been edited)
  const directory = useMemo(() => loadWorkers(), [sheet, picking]); // eslint-disable-line react-hooks/exhaustive-deps
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
      setPicking(false);
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
        setPicking(false);
      }}
      disabled={nothingToEdit}
      label={t('crew.edit.on')}
      doneLabel={t('crew.edit.done')}
      testId="crew-edit-toggle"
    />
  );

  return (
    <Block icon={<UsersIcon size={32} />} label={t('ws.menu.crew')} id="crew" title={t('ws.crew.title')} meta={`${t(crew.length === 1 ? 'ws.crew.count1' : 'ws.crew.countN', { n: crew.length })}${days !== null ? ` · ${days} ${t('sched.d')}` : ''}`} open={open} onToggle={onToggle} testId="ws-crew" tall headerAction={editToggle}>
      <div className="space-y-3">
        {/* the dates set the days of the machinery rental (a direct cost): read-only, with the shield, while the quote is frozen / signed.
            The people and their advances below are operational, so they stay editable. */}
        <LockedZone locked={locked} onBlocked={onBlocked}>
          <Dates project={project} setProject={setProject} />
        </LockedZone>

        {/* the control line right above the list: the [+] unfolds the personnel selector (trade filters + proximity radar) in place;
            the labour balance is read BEFORE handing out an advance */}
        <div className="space-y-2">
          <div className="flex items-center gap-3" data-testid="crew-bar">
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              disabled={crew.length >= CREW_LIMIT}
              aria-label={t('ws.crew.add')}
              aria-expanded={picking}
              title={t('ws.crew.add')}
              data-testid="crew-add"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl font-medium leading-none text-brand transition active:scale-95 disabled:opacity-40"
            >
              <span aria-hidden="true" className={`transition-transform ${picking ? 'rotate-45' : ''}`}>
                +
              </span>
            </button>
            <p data-testid="labor-pool" data-available={pool.available} data-spent={pool.advanced} className="min-w-0 flex-1 text-right text-sm text-neutral-300">
              {t('ws.crew.labor')}: <b className="tabular-nums text-neutral-200">{money(pool.available)}</b>
              <span className="whitespace-nowrap tabular-nums text-[#e8c35f]"> ({t('ws.crew.spent')}: {money(pool.advanced)})</span>
            </p>
          </div>
          {picking && (
            <CrewPicker
              project={project}
              crew={crew}
              onClose={() => setPicking(false)}
              onAdd={(data) => {
                setProject((p) => withWorker(p, data));
                setPicking(false);
              }}
            />
          )}
          {crew.length === 0 ? (
            <p className="text-sm text-neutral-400" data-testid="crew-empty">
              {t('ws.crew.empty')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="crew-list">
              {rows.map((row) => (
                <WorkerCard
                  key={row.worker.id}
                  row={row}
                  health={healthOf(row.worker)}
                  birthday={birthdayOf(row.worker)}
                  editing={editMode}
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
        </div>

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
