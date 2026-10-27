import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { SCHEDULE, parseISODay } from '../../lib/schedule.js';
import { laborPool } from '../../lib/ledger.js';
import { partidaTitle } from '../../lib/reports.js';
import { DEADLINE_MAX_DAYS, crewModel, withCrew, withCrewAuto, withDeadlineDays } from '../../lib/workspaceModel.js';
import Block from './Block.jsx';
import LockedZone from './LockedZone.jsx';
import AdvancesPanel from './AdvancesPanel.jsx';
import NumberPad from './NumberPad.jsx';

function Stat({ label, value, unit, tone }) {
  return (
    <div className="rounded-xl border border-white/10 p-2.5">
      <p className="text-xs font-semibold text-[#E0E0E0]/70">{label}</p>
      <p className={`text-xl font-extrabold tabular-nums ${tone === 'brand' ? 'text-brand' : ''}`}>
        {value} <span className="text-sm font-semibold text-[#E0E0E0]/70">{unit}</span>
      </p>
    </div>
  );
}

/** One partida on the timeline: solid = active work, dashed outline = technical wait (zero effort). */
function Bar({ row, total }) {
  const pct = (d) => `${(d / total) * 100}%`;
  return (
    <div className="relative h-3 w-full" aria-hidden="true">
      <div className="absolute top-0 h-full rounded-sm bg-brand" style={{ left: pct(row.start), width: pct(Math.max(row.activeDays, 0.001)), minWidth: 3 }} />
      {row.deadDays > 0 && <div className="absolute top-0 h-full rounded-sm border border-dashed border-white/50" style={{ left: pct(row.activeEnd), width: pct(row.deadDays) }} />}
    </div>
  );
}

/**
 * ZONE B, "Cuadrilla y cronograma": the people on site, the job's deadline in days, the calendar the engine derives and the
 * cash advanced to workers. Crew size and deadline are typed on the app's numpad (never the OS keyboard); both move the
 * quote in real time (the crew sets the rental days) and are read-only while the budget is locked.
 */
export default function CrewBlock({ project, result, locked, onBlocked, setDraft, setProject, open, onToggle }) {
  const { t, num, date } = useI18n();
  const [pad, setPad] = useState(null); // 'crew' | 'days'
  const model = crewModel(result);
  const d = t('sched.d');
  const days = (v) => num(v, 1);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const setAdvances = (list) => setProject((p) => ({ ...p, advances: list }));
  const day = (iso) => date(parseISODay(iso));
  const setCrew = (n) => setDraft((x) => withCrew(x, n));

  const plan = model?.plan;
  const deadlineMsg = !plan || plan.fits === null ? null : plan.fits ? { ok: true, text: t('sched.deadline.ok', { days: plan.spareDays }) } : { ok: false, text: plan.auto ? t('sched.deadline.impossible') : t('sched.deadline.over', { days: -plan.spareDays }) };

  return (
    <Block id="crew" title={t('ws.crew.title')} meta={model ? t('ws.crew.summary', { n: model.crew, days: days(model.totals.totalDays) }) : ''} open={open} onToggle={onToggle} testId="ws-crew">
      {!model ? (
        <p className="mb-4 text-sm text-[#E0E0E0]/60" data-testid="crew-empty">
          {t('sched.empty')}
        </p>
      ) : (
        <div className="space-y-4" aria-live="polite">
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t('sched.hh')} value={num(model.totals.hh, 1)} unit="HH" />
            <Stat label={t('sched.active')} value={days(model.totals.activeDays)} unit={d} />
            <Stat label={t('sched.dead')} value={days(model.totals.deadDays)} unit={d} />
            <Stat label={t('sched.total')} value={days(model.totals.totalDays)} unit={d} tone="brand" />
          </div>

          <div className="border-l-2 border-white/25 pl-3" data-testid="sched-plan">
            <p className="text-sm font-semibold" data-testid="sched-window">
              {t('sched.window', { start: day(plan.startDate), end: day(plan.estimatedEnd) })}
            </p>
            {deadlineMsg && (
              <p data-testid="sched-deadline" data-fits={deadlineMsg.ok ? 'true' : 'false'} className="mt-1 text-sm font-semibold" style={{ color: deadlineMsg.ok ? '#22c55e' : '#f97316' }}>
                {deadlineMsg.text}
              </p>
            )}
            {!plan.hasDeadline && <p className="mt-1 text-xs text-[#E0E0E0]/60">{t('sched.noEnd')}</p>}
          </div>

          <LockedZone locked={locked} onBlocked={onBlocked}>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#E0E0E0]/80">{model.auto ? t('sched.auto') : t('sched.crew')}</p>
                {model.canAuto && (
                  <button type="button" onClick={() => setDraft(withCrewAuto)} data-testid="crew-auto" className="min-h-[40px] rounded-lg border border-[#d4af37]/60 px-3 text-xs font-bold text-[#e8c35f]">
                    ↺ {t('sched.auto.reset')}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" data-testid="crew-minus" aria-label={t('sched.crew.remove')} disabled={model.crew <= SCHEDULE.minCrew} onClick={() => setCrew(model.crew - 1)} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/20 text-3xl font-bold active:scale-95 disabled:opacity-30">
                  −
                </button>
                <button type="button" onClick={() => setPad('crew')} data-testid="crew-count" aria-label={t('ws.crew.people')} className="min-h-[56px] min-w-0 flex-1 rounded-2xl border border-white/15 text-center active:border-white/50">
                  <span className="block text-3xl font-extrabold tabular-nums leading-none">{model.crew}</span>
                  <span className="mt-1 block text-xs tabular-nums text-brand">
                    {days(model.totals.totalDays)} {d} · {num(model.totals.hh, 1)} HH
                  </span>
                </button>
                <button type="button" data-testid="crew-plus" aria-label={t('sched.crew.add')} disabled={model.crew >= SCHEDULE.maxCrew} onClick={() => setCrew(model.crew + 1)} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-brand text-3xl font-bold text-brand active:scale-95 disabled:opacity-30">
                  +
                </button>
              </div>
              <button type="button" onClick={() => setPad('days')} data-testid="crew-deadline" className="flex min-h-[52px] w-full items-center justify-between rounded-xl border border-white/15 px-3 active:border-white/50">
                <span className="text-sm text-[#E0E0E0]/70">{t('ws.crew.deadline')}</span>
                <span className="text-base font-extrabold tabular-nums">{plan.availableDays ? t('ws.crew.deadlineVal', { n: plan.availableDays }) : t('ws.crew.none')}</span>
              </button>
            </div>
          </LockedZone>

          <ul className="space-y-3" data-testid="sched-timeline">
            {model.rows.map((r) => (
              <li key={r.index} className="space-y-1">
                <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                  <span className="font-semibold">
                    {r.index + 1}. {partidaTitle(result.partidas[r.index], t)}
                  </span>
                  <span className="tabular-nums text-[#E0E0E0]/70">
                    {num(r.hh, 1)} HH · {days(r.activeDays)} {d}
                    {r.deadDays > 0 && ` + ${days(r.deadDays)} ${d}`}
                  </span>
                </p>
                <Bar row={r} total={Math.max(model.totals.totalDays, 0.5)} />
                {r.dead.length > 0 && <p className="text-xs text-[#E0E0E0]/60">{r.dead.map((x) => `${t(`sched.dead.${x.key}`)} · ${x.days} ${d}`).join('  |  ')}</p>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[#E0E0E0]/60">{t('sched.note')}</p>
        </div>
      )}

      <div className={model ? 'mt-5 border-t border-white/10 pt-4' : ''}>
        <AdvancesPanel advances={project.advances} pool={pool} onChange={setAdvances} />
      </div>

      {pad === 'crew' && model && (
        <NumberPad testId="crew-pad" title={t('ws.crew.people')} unit="" value={model.crew} decimals={0} max={SCHEDULE.maxCrew} foot={t('ws.crew.range', { min: SCHEDULE.minCrew, max: SCHEDULE.maxCrew })} onChange={setCrew} onClose={() => setPad(null)} />
      )}
      {pad === 'days' && model && (
        <NumberPad
          testId="days-pad"
          title={t('ws.crew.padDays')}
          unit={d}
          value={plan.availableDays}
          decimals={0}
          max={DEADLINE_MAX_DAYS}
          foot={t('ws.crew.padDaysFoot', { start: day(plan.startDate) })}
          onChange={(n) => setProject((p) => withDeadlineDays(p, n))}
          onClose={() => setPad(null)}
        />
      )}
    </Block>
  );
}
