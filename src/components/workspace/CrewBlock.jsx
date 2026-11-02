import { useId, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CREW_LIMIT, LEDGER_LIMITS, WORKER_SPECIALTIES, advancesByWorker, laborPool } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { calendarDays, withAdvance, withProjectDates, withWorker, withWorkerEdited, withoutAdvance, withoutWorker } from '../../lib/workspaceModel.js';
import BottomSheet from '../BottomSheet.jsx';
import { DateInput, TextField } from '../ui.jsx';
import Block from './Block.jsx';
import NumberPad from './NumberPad.jsx';
import { SPECIALTY_ICON, UsersIcon } from './icons.jsx';

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
          <label className="label" htmlFor={startId}>
            {t('ws.crew.start')}
          </label>
          <DateInput id={startId} value={project.startDate} onChange={(e) => setProject((p) => withProjectDates(p, { startDate: e.target.value }))} data-testid="crew-start" />
        </div>
        <div>
          <label className="label" htmlFor={endId}>
            {t('ws.crew.end')}
          </label>
          <DateInput id={endId} value={project.endDate} min={project.startDate || undefined} onChange={(e) => setProject((p) => withProjectDates(p, { endDate: e.target.value }))} data-testid="crew-end" />
        </div>
      </div>
      <p className="flex min-h-[44px] items-center justify-between rounded-xl border border-white/10 px-3 text-sm" data-testid="crew-duration" data-days={days ?? ''}>
        <span className="text-[#E0E0E0]/70">{t('ws.crew.duration')}</span>
        <span className="text-base font-extrabold tabular-nums">{days === null ? '—' : t(days === 1 ? 'ws.crew.day1' : 'ws.crew.dayN', { n: days })}</span>
      </p>
    </div>
  );
}

/** Add / edit one person: name, specialty (closed list) and an optional line of tasks or notes. */
function WorkerSheet({ worker, onSave, onDelete, onClose }) {
  const { t } = useI18n();
  const [name, setName] = useState(worker?.name ?? '');
  const [specialty, setSpecialty] = useState(worker?.specialty ?? 'multi');
  const [notes, setNotes] = useState(worker?.notes ?? '');
  const specId = useId();
  const ready = name.trim().length > 0;
  return (
    <BottomSheet title={worker ? t('ws.crew.sheetEdit') : t('ws.crew.sheetNew')} onClose={onClose}>
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
        <button type="submit" disabled={!ready} data-testid="crew-save" className="min-h-[56px] w-full rounded-xl border-2 border-brand px-3 text-base font-extrabold text-brand disabled:opacity-40">
          {t('ws.crew.save')}
        </button>
        {worker && (
          <div className="space-y-1">
            <button type="button" onClick={onDelete} data-testid="crew-delete" className="min-h-[52px] w-full rounded-xl border border-red-500/40 px-3 text-sm font-bold text-red-400 active:border-red-400">
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
function WorkerCard({ row, onEdit, onAdvance, onRemoveAdvance }) {
  const { t, money, locale } = useI18n();
  const { worker: w, list, total } = row;
  const Icon = SPECIALTY_ICON[w.specialty] ?? SPECIALTY_ICON.other;
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  return (
    <li className="rounded-xl border border-white/10 bg-black" data-testid={`worker-${w.id}`} data-specialty={w.specialty}>
      <button type="button" onClick={onEdit} data-testid={`worker-edit-${w.id}`} aria-label={`${t('ws.crew.sheetEdit')}: ${w.name}`} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black">
        <Icon size={26} className="text-brand" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold" data-testid={`worker-name-${w.id}`}>
            {w.name}
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
      <div className="border-t border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#E0E0E0]/70">{t('ws.crew.advanced')}</p>
          <p className="text-base font-extrabold tabular-nums" data-testid={`worker-total-${w.id}`} data-total={total}>
            {total > 0 ? money(total) : t('ws.crew.noAdvances')}
          </p>
        </div>
        {list.length > 0 && (
          <ul className="mt-1 divide-y divide-white/10" data-testid={`worker-advlist-${w.id}`}>
            {list.map((a) => (
              <li key={a.id} className="flex min-h-[44px] items-center gap-3">
                <span className="min-w-0 flex-1 text-xs text-[#E0E0E0]/60">{stamp(a.at)}</span>
                <span className="text-sm font-bold tabular-nums">{money(a.amount)}</span>
                <button type="button" onClick={() => onRemoveAdvance(a.id)} aria-label={`${t('common.delete')}: ${w.name}`} data-testid={`worker-adv-del-${a.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={onAdvance} data-testid={`worker-adv-${w.id}`} className="mt-2 min-h-[52px] w-full rounded-xl border border-brand px-3 text-base font-extrabold text-brand active:scale-[0.99]">
          {t('ws.crew.advance')}
        </button>
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
export default function CrewBlock({ project, result, setProject, open, onToggle }) {
  const { t, money, region } = useI18n();
  const [sheet, setSheet] = useState(null); // null | 'new' | worker id
  const [advFor, setAdvFor] = useState(null); // worker id whose advance is being typed on the pad
  const amount = useRef(0);
  const crew = project.crew ?? [];
  const { rows, loose, looseTotal } = advancesByWorker(crew, project.advances);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const days = calendarDays(project);
  const editing = sheet && sheet !== 'new' ? crew.find((w) => w.id === sheet) : null;

  const closeAdvance = () => {
    const n = amount.current;
    amount.current = 0;
    if (advFor && n > 0) setProject((p) => withAdvance(p, advFor, n));
    setAdvFor(null);
  };
  const advanceFull = (project.advances ?? []).length >= LEDGER_LIMITS.advances;

  return (
    <Block icon={<UsersIcon />} id="crew" title={t('ws.crew.title')} meta={`${t('ws.crew.count', { n: crew.length })}${days !== null ? ` · ${days} ${t('sched.d')}` : ''}`} open={open} onToggle={onToggle} testId="ws-crew">
      <div className="space-y-5">
        <Dates project={project} setProject={setProject} />

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
          <button type="button" onClick={() => setSheet('new')} disabled={crew.length >= CREW_LIMIT} data-testid="crew-add" className="min-h-[56px] w-full rounded-xl border-2 border-brand px-3 text-base font-extrabold text-brand disabled:opacity-40">
            {t('ws.crew.add')}
          </button>
        </div>

        {/* what the labour line of the quote still allows once every advance (to anybody) is discounted */}
        <p data-testid="labor-pool" data-available={pool.available} className="text-sm text-[#E0E0E0]/80">
          {t('adv.pool')}: <b className="tabular-nums text-[#E0E0E0]">{money(pool.available)}</b>
          {pool.advanced > 0 && <span className="text-[#e8c35f]"> (−{money(pool.advanced)})</span>}
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
                  <span className="text-sm font-bold tabular-nums">{money(a.amount)}</span>
                  <button type="button" onClick={() => setProject((p) => withoutAdvance(p, a.id))} aria-label={`${t('common.delete')}: ${a.worker}`} data-testid={`worker-adv-del-${a.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {sheet && (sheet === 'new' || editing) && (
        <WorkerSheet
          worker={editing}
          onClose={() => setSheet(null)}
          onSave={(data) => {
            setProject((p) => (editing ? withWorkerEdited(p, editing.id, data) : withWorker(p, data)));
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
