import { useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CREW_LIMIT, LEDGER_LIMITS, WORKER_SPECIALTIES, advancesByWorker, laborPool } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { hasHealthNotes, loadWorkers } from '../../lib/workers.js';
import { calendarDays, withAdvance, withProjectDates, withWorker, withWorkerEdited, withoutAdvance, withoutWorker } from '../../lib/workspaceModel.js';
import BottomSheet from '../BottomSheet.jsx';
import { DateInput, TextField } from '../ui.jsx';
import Block from './Block.jsx';
import { crewHealth } from '../../lib/crewMatch.js';
import CrewPicker from './CrewPicker.jsx';
import LockedZone from './LockedZone.jsx';
import NumberPad from './NumberPad.jsx';
import { BanknoteIcon, SPECIALTY_ICON, UsersIcon } from './icons.jsx';

/** The two job dates, typed by hand, and the days between them (a plain subtraction, no estimate). */
function Dates({ project, setProject }) {
  const { t } = useI18n();
  const startId = useId();
  const endId = useId();
  const days = calendarDays(project);
  return (
    <div className="space-y-3" data-testid="crew-dates">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label tabular-nums" htmlFor={startId}>
            {t('ws.crew.start')}
          </label>
          <DateInput id={startId} value={project.startDate} onChange={(e) => setProject((p) => withProjectDates(p, { startDate: e.target.value }))} data-testid="crew-start" />
        </div>
        <div>
          <label className="label tabular-nums" htmlFor={endId}>
            {t('ws.crew.end')}
          </label>
          <DateInput id={endId} value={project.endDate} min={project.startDate || undefined} onChange={(e) => setProject((p) => withProjectDates(p, { endDate: e.target.value }))} data-testid="crew-end" />
        </div>
      </div>
      <p className="flex min-h-[44px] items-center justify-between rounded-xl border border-white/10 px-3 text-sm" data-testid="crew-duration" data-days={days ?? ''}>
        <span className="text-[#E0E0E0]/70">{t('ws.crew.duration')}</span>
        <span className="text-base font-medium tabular-nums">{days === null ? '—' : t(days === 1 ? 'ws.crew.day1' : 'ws.crew.dayN', { n: days })}</span>
      </p>
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
        <dt className="text-xs font-medium uppercase tracking-wider text-orange-300">{label}</dt>
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
              <dt className="text-xs font-medium uppercase tracking-wider text-orange-300">{t('squadra.emName')}</dt>
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
        <button type="submit" disabled={!ready} data-testid="crew-save" className="min-h-[56px] w-full rounded-xl border-2 border-brand px-3 text-base font-medium text-brand disabled:opacity-40">
          {t('ws.crew.save')}
        </button>
        {worker && (
          <div className="space-y-1">
            <button type="button" onClick={onDelete} data-testid="crew-delete" className="min-h-[52px] w-full rounded-xl border border-red-500/40 px-3 text-sm font-medium text-red-400 active:border-red-400">
              {t('common.delete')}
            </button>
            <p className="text-center text-xs text-[#E0E0E0]/60">{t('ws.crew.deleteNote')}</p>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}

/** One person: icon of the role, name, specialty, notes, the cash advanced to them and the button that hands over a new advance. */
function WorkerCard({ row, health = false, onEdit, onAdvance, onRemoveAdvance }) {
  const { t, money, locale } = useI18n();
  const { worker: w, list, total } = row;
  const Icon = SPECIALTY_ICON[w.specialty] ?? SPECIALTY_ICON.other;
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  return (
    <li className="rounded-xl border border-white/10 bg-black" data-testid={`worker-${w.id}`} data-specialty={w.specialty}>
      <button type="button" onClick={onEdit} data-testid={`worker-edit-${w.id}`} aria-label={`${t('ws.crew.sheetEdit')}: ${w.name}${health ? ` · ⚠ ${t('squadra.healthFlag')}` : ''}`} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black">
        <Icon size={26} className="text-brand" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-base font-medium" data-testid={`worker-name-${w.id}`}>
              {w.name}
            </span>
            {/* safety: the warning of the worker's file (limiting condition / allergy) stays on the card for as long as they are on the job */}
            {health && (
              <span role="img" aria-label={t('squadra.healthFlag')} title={t('squadra.healthFlag')} data-testid={`worker-health-${w.id}`} className="shrink-0 text-lg leading-none text-orange-500">
                ⚠
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-[#E0E0E0]/70" data-testid={`worker-spec-${w.id}`}>
            {t(`ws.spec.${w.specialty}`)}
            {w.notes ? ` · ${w.notes}` : ''}
          </span>
        </span>
        <span aria-hidden="true" className="text-lg text-[#E0E0E0]/50">
          ›
        </span>
      </button>
      {/* the main action of the card, on its front face: always visible, big, green (OLED: black ground, coloured border + text) */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onAdvance}
          data-testid={`worker-adv-${w.id}`}
          className="flex min-h-[60px] w-full items-center justify-center gap-3 rounded-xl border-2 border-emerald-500 bg-black px-3 text-lg font-medium text-emerald-400 transition active:scale-[0.98] active:border-emerald-300"
        >
          <BanknoteIcon size={28} />
          <span>{t('ws.crew.advance')}</span>
        </button>
      </div>
      <div className="border-t border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#E0E0E0]/70">{t('ws.crew.advanced')}</p>
          <p className="text-base font-medium tabular-nums" data-testid={`worker-total-${w.id}`} data-total={total}>
            {total > 0 ? money(total) : t('ws.crew.noAdvances')}
          </p>
        </div>
        {list.length > 0 && (
          <ul className="mt-1 divide-y divide-white/10" data-testid={`worker-advlist-${w.id}`}>
            {list.map((a) => (
              <li key={a.id} className="flex min-h-[44px] items-center gap-3">
                <span className="min-w-0 flex-1 text-xs text-[#E0E0E0]/60">{stamp(a.at)}</span>
                <span className="text-sm font-medium tabular-nums">{money(a.amount)}</span>
                <button type="button" onClick={() => onRemoveAdvance(a.id)} aria-label={`${t('common.delete')}: ${w.name}`} data-testid={`worker-adv-del-${a.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
  const [sheet, setSheet] = useState(null); // null | 'new' | worker id
  const [advFor, setAdvFor] = useState(null); // worker id whose advance is being typed on the pad
  const amount = useRef(0);
  const crew = project.crew ?? [];
  const { rows, loose, looseTotal } = advancesByWorker(crew, project.advances);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const days = calendarDays(project);
  const editing = sheet && sheet !== 'new' ? crew.find((w) => w.id === sheet) : null;
  // the directory is read again whenever a sheet opens or closes (its file may have just been edited)
  const directory = useMemo(() => loadWorkers(), [sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  const healthOf = (w) => crewHealth(w, directory);

  const closeAdvance = () => {
    const n = amount.current;
    amount.current = 0;
    if (advFor && n > 0) setProject((p) => withAdvance(p, advFor, n));
    setAdvFor(null);
  };
  const advanceFull = (project.advances ?? []).length >= LEDGER_LIMITS.advances;

  return (
    <Block icon={<UsersIcon size={32} />} label={t('ws.menu.crew')} id="crew" title={t('ws.crew.title')} meta={`${t(crew.length === 1 ? 'ws.crew.count1' : 'ws.crew.countN', { n: crew.length })}${days !== null ? ` · ${days} ${t('sched.d')}` : ''}`} open={open} onToggle={onToggle} testId="ws-crew">
      <div className="space-y-5">
        {/* the dates set the days of the machinery rental (a direct cost): read-only, with the shield, while the quote is frozen / signed.
            The people and their advances below are operational, so they stay editable. */}
        <LockedZone locked={locked} onBlocked={onBlocked}>
          <Dates project={project} setProject={setProject} />
        </LockedZone>

        <div className="space-y-3">
          {crew.length === 0 ? (
            <p className="text-sm text-[#E0E0E0]/60" data-testid="crew-empty">
              {t('ws.crew.empty')}
            </p>
          ) : (
            <ul className="space-y-3" data-testid="crew-list">
              {rows.map((row) => (
                <WorkerCard
                  key={row.worker.id}
                  row={row}
                  health={healthOf(row.worker)}
                  onEdit={() => setSheet(row.worker.id)}
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
          <button type="button" onClick={() => setSheet('new')} disabled={crew.length >= CREW_LIMIT} data-testid="crew-add" className="min-h-[56px] w-full rounded-xl border-2 border-brand px-3 text-base font-medium text-brand disabled:opacity-40">
            {t('ws.crew.add')}
          </button>
        </div>

        {/* what the labour line of the quote still allows once every advance (to anybody) is discounted */}
        <p data-testid="labor-pool" data-available={pool.available} className="text-sm text-[#E0E0E0]/80">
          {t('adv.pool')}: <b className="tabular-nums text-[#E0E0E0]">{money(pool.available)}</b>
          {pool.advanced > 0 && <span className="text-[#e8c35f] tabular-nums"> (−{money(pool.advanced)})</span>}
        </p>

        {loose.length > 0 && (
          <div className="space-y-1" data-testid="advances-loose" data-total={looseTotal}>
            <p className="flex justify-between text-xs font-semibold text-[#E0E0E0]/70">
              <span>{t('ws.crew.loose')}</span>
              <span className="tabular-nums">{money(looseTotal)}</span>
            </p>
            <ul className="divide-y divide-white/10">
              {loose.map((a) => (
                <li key={a.id} className="flex min-h-[44px] items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{a.worker}</span>
                  <span className="text-sm font-medium tabular-nums">{money(a.amount)}</span>
                  <button type="button" onClick={() => setProject((p) => withoutAdvance(p, a.id))} aria-label={`${t('common.delete')}: ${a.worker}`} data-testid={`worker-adv-del-${a.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {sheet === 'new' && (
        <CrewPicker
          project={project}
          crew={crew}
          onClose={() => setSheet(null)}
          onAdd={(data) => {
            setProject((p) => withWorker(p, data));
            setSheet(null);
          }}
        />
      )}
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
