import { useI18n } from '../lib/i18n.jsx';
import { SCHEDULE, clampCrew, parseISODay } from '../lib/schedule.js';
import { partidaTitle } from '../lib/reports.js';
import BottomSheet from './BottomSheet.jsx';

function Stat({ label, hint, value, unit, tone }) {
  return (
    <div className="rounded-2xl border border-white/10 p-3">
      <p className="text-sm font-semibold text-neutral-300">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums ${tone === 'brand' ? 'text-brand' : ''}`}>
        {value} <span className="text-base font-semibold text-neutral-300">{unit}</span>
      </p>
      <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>
    </div>
  );
}

/** One partida on the timeline: solid green = active work, dashed outline = technical wait (0 effort). */
function Bar({ row, total }) {
  const pct = (d) => `${(d / total) * 100}%`;
  return (
    <div className="relative h-4 w-full" aria-hidden="true">
      <div className="absolute top-0 h-full rounded-sm bg-brand" style={{ left: pct(row.start), width: pct(Math.max(row.activeDays, 0.001)), minWidth: 3 }} />
      {row.deadDays > 0 && (
        <div className="absolute top-0 h-full rounded-sm border border-dashed border-white/50" style={{ left: pct(row.activeEnd), width: pct(row.deadDays) }} />
      )}
    </div>
  );
}

/**
 * Planning sheet. The crew stepper is anchored at the bottom (thumb zone) with large + / - targets; the
 * active days and the total shrink or grow live while the dead technical time stays exactly the same.
 */
export default function ScheduleSheet({ draft, setDraft, result, onClose }) {
  const { t, num, date } = useI18n();
  const s = result.schedule;
  const plan = s.plan;
  const auto = plan.auto && plan.hasDeadline; // the crew follows the project's deadline
  const d = t('sched.d');
  const days = (v) => num(v, 1);
  const crew = clampCrew(s.crew); // the crew actually planned (automatic or manual)
  // Touching + / - takes manual control starting from the crew currently shown.
  const setCrew = (delta) => setDraft((x) => ({ ...x, crew: clampCrew(crew + delta), crewAuto: false }));
  const backToAuto = () => setDraft((x) => ({ ...x, crewAuto: true }));
  const day = (iso) => date(parseISODay(iso));
  const deadlineMsg =
    plan.fits === null
      ? null
      : plan.fits
        ? { tone: 'ok', text: t('sched.deadline.ok', { days: plan.spareDays }) }
        : plan.auto
          ? { tone: 'bad', text: t('sched.deadline.impossible') }
          : { tone: 'bad', text: t('sched.deadline.over', { days: -plan.spareDays }) };
  const rows = s.rows.filter((r) => r.hh > 0);

  return (
    <BottomSheet title={t('sched.title')} subtitle={t('sched.sub')} onClose={onClose}>
      <div data-testid="schedule-sheet">
        {rows.length === 0 ? (
          <p className="card text-neutral-300">{t('sched.empty')}</p>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('sched.hh')} hint={t('sched.hh.desc')} value={num(s.totals.hh, 1)} unit="HH" />
              <Stat label={t('sched.dead')} hint={t('sched.dead.desc')} value={days(s.totals.deadDays)} unit={d} />
              <Stat label={t('sched.active')} hint={t('sched.active.desc')} value={days(s.totals.activeDays)} unit={d} />
              <Stat label={t('sched.total')} hint={t('sched.perDay', { h: s.hoursPerDay })} value={days(s.totals.totalDays)} unit={d} tone="brand" />
            </div>

            <section className="rounded-2xl border border-white/10 p-3" data-testid="sched-plan">
              <p className="text-sm font-semibold" data-testid="sched-window">
                {t('sched.window', { start: day(plan.startDate), end: day(plan.estimatedEnd) })}
              </p>
              {deadlineMsg && (
                <p
                  data-testid="sched-deadline"
                  data-fits={plan.fits ? 'true' : 'false'}
                  className={`mt-1 text-sm font-semibold ${deadlineMsg.tone === 'ok' ? 'text-brand' : 'text-orange-400'}`}
                >
                  {deadlineMsg.text}
                </p>
              )}
              {!plan.hasDeadline && (
                <p className="mt-1 text-xs text-neutral-400" data-testid="sched-noend">
                  {t('sched.noEnd')}
                </p>
              )}
            </section>

            <section aria-labelledby="sched-tl" className="rounded-2xl border border-white/10 p-3">
              <h3 id="sched-tl" className="mb-2 font-bold">
                {t('sched.timeline')}
              </h3>
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li key={r.index} className="space-y-1">
                    <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                      <span className="font-semibold">
                        {r.index + 1}. {partidaTitle(result.partidas[r.index], t)}
                      </span>
                      <span className="tabular-nums text-neutral-300">
                        {num(r.hh, 1)} HH · {days(r.activeDays)} {d}
                        {r.deadDays > 0 && ` + ${days(r.deadDays)} ${d}`}
                      </span>
                    </p>
                    <Bar row={r} total={Math.max(s.totals.totalDays, 0.5)} />
                    {r.dead.length > 0 && (
                      <p className="text-xs text-neutral-400">
                        {r.dead.map((x) => `${t(`sched.dead.${x.key}`)} · ${x.days} ${d}`).join('  |  ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-3 w-5 rounded-sm bg-brand" />
                  {t('sched.legend.active')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-3 w-5 rounded-sm border border-dashed border-white/50" />
                  {t('sched.legend.dead')}
                </span>
              </p>
            </section>
            <p className="text-xs text-neutral-400">{t('sched.note')}</p>
          </div>
        )}

        {/* Thumb zone: crew stepper pinned to the bottom of the sheet while the content scrolls. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 border-t border-white/10 bg-black px-5 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p id="crew-label" className="text-sm font-semibold text-neutral-300">
              {auto ? t('sched.auto') : t('sched.crew')}
            </p>
            {plan.hasDeadline && !plan.auto && (
              <button
                type="button"
                onClick={backToAuto}
                data-testid="crew-auto"
                className="min-h-[36px] shrink-0 rounded-lg border border-[#d4af37]/60 px-3 text-xs font-bold text-[#e8c35f]"
              >
                ↺ {t('sched.auto.reset')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="crew-minus"
              aria-label={t('sched.crew.remove')}
              disabled={crew <= SCHEDULE.minCrew}
              onClick={() => setCrew(-1)}
              className="flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-2xl border border-white/20 bg-black text-4xl font-bold transition active:scale-95 active:border-brand disabled:opacity-30"
            >
              −
            </button>
            <p className="min-w-0 flex-1 text-center" aria-labelledby="crew-label" role="status">
              <span data-testid="crew-count" className="block text-4xl font-extrabold tabular-nums leading-none">
                {crew}
              </span>
              {rows.length > 0 && (
                <span data-testid="crew-total" className="mt-1 block text-sm tabular-nums text-brand">
                  {days(s.totals.totalDays)} {d} · {num(s.totals.hh, 1)} HH
                </span>
              )}
            </p>
            <button
              type="button"
              data-testid="crew-plus"
              aria-label={t('sched.crew.add')}
              disabled={crew >= SCHEDULE.maxCrew}
              onClick={() => setCrew(1)}
              className="flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-2xl border border-brand bg-brand/10 text-4xl font-bold text-brand transition active:scale-95 disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
