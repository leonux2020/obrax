import { useId, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { PHASE_LIMIT, newEntryId } from '../../lib/ledger.js';
import { parseISODay } from '../../lib/schedule.js';
import { phaseDaysLeft, phaseState, sortPhases } from '../../lib/phases.js';
import { calendarDays, quoteLock, withPhaseAdded, withPhaseEdited, withoutPhase } from '../../lib/workspaceModel.js';
import { RowDelete } from '../EditControls.jsx';
import { DateInput } from '../ui.jsx';
import Block from './Block.jsx';
import LockedZone from './LockedZone.jsx';
import { Outline } from './icons.jsx';

/** The calendar of the sixth circle (local, outline: the shared icon set stays frozen). */
const CalendarIcon = (props) => (
  <Outline size={32} icon="calendar" {...props}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16" />
    <path d="M8.5 3.5v4" />
    <path d="M15.5 3.5v4" />
  </Outline>
);

const NODE = {
  done: 'bg-white/10 text-neutral-300',
  active: 'bg-brand ring-4 ring-brand/20',
  pending: 'border border-neutral-600 bg-black',
};
const TITLE = { done: 'text-neutral-500', active: 'font-medium text-neutral-100', pending: 'text-neutral-500' };

/**
 * One phase of the job on the vertical line. The node says where it stands: a check (completed, dim text), the primary colour (in progress, bright
 * text and the days left) or an empty ring (pending, quiet text). Tapping the row unfolds it (accordion, one at a time, no modal): name, start and
 * end with the phone's native date pickers, "mark as completed" and delete.
 */
function PhaseRow({ phase, state, open, locked, onBlocked, now, onToggle, onEdit, onRemove }) {
  const { t, locale } = useI18n();
  const panelId = useId();
  const fmt = (iso) => (parseISODay(iso) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseISODay(iso)) : '');
  const left = state === 'active' ? phaseDaysLeft(phase, now) : null;
  const range = [fmt(phase.startDate), fmt(phase.endDate)].filter(Boolean).join(' → ');
  const name = phase.name.trim() || t('tl.untitled');
  const dated = Boolean(phase.startDate || phase.endDate);
  const leftText = left === null ? '' : left > 1 ? t('tl.leftN', { n: left }) : left === 1 ? t('tl.left1') : left === 0 ? t('tl.leftToday') : t('tl.late', { n: -left });
  return (
    <li className="relative pl-6" data-testid={`phase-${phase.id}`} data-state={state}>
      <span aria-hidden="true" data-testid={`phase-node-${phase.id}`} className={`absolute -left-[11px] top-3 flex h-5 w-5 items-center justify-center rounded-full ${NODE[state]}`}>
        {state === 'done' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" data-icon="check">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} data-testid={`phase-toggle-${phase.id}`} className="block min-h-[44px] w-full py-2 text-left">
        <span className={`block truncate text-base ${TITLE[state]}`} data-testid={`phase-name-${phase.id}`}>
          {name}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-neutral-500" data-testid={`phase-sub-${phase.id}`}>
          <span>{range || t('tl.nodates')}</span>
          {leftText && (
            <span className={left < 0 ? 'text-[#e8c35f]' : 'text-brand'} data-testid={`phase-left-${phase.id}`} data-days={left}>
              {leftText}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="acc-open" id={panelId} data-testid={`phase-panel-${phase.id}`}>
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-3 pb-4 pt-1">
              <div>
                <label className="label" htmlFor={`${panelId}-name`}>
                  {t('tl.name')}
                </label>
                <input id={`${panelId}-name`} type="text" value={phase.name} maxLength={60} onChange={(e) => onEdit({ name: e.target.value })} placeholder={t('tl.untitled')} data-testid={`phase-input-${phase.id}`} className="field-input min-h-[48px]" />
              </div>
              {/* the dates set the days of the machinery rental (a direct cost): read-only, with the shield, while the quote is frozen / signed */}
              <LockedZone locked={locked} onBlocked={onBlocked}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor={`${panelId}-start`}>
                      {t('ws.crew.start')}
                    </label>
                    <DateInput id={`${panelId}-start`} value={phase.startDate} onChange={(e) => onEdit({ startDate: e.target.value })} data-testid={`phase-start-${phase.id}`} className="min-h-[48px] text-base" />
                  </div>
                  <div>
                    <label className="label" htmlFor={`${panelId}-end`}>
                      {t('ws.crew.end')}
                    </label>
                    <DateInput id={`${panelId}-end`} value={phase.endDate} min={phase.startDate || undefined} onChange={(e) => onEdit({ endDate: e.target.value })} data-testid={`phase-end-${phase.id}`} className="min-h-[48px] text-base" />
                  </div>
                </div>
              </LockedZone>
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => onEdit({ done: !phase.done })} data-testid={`phase-done-${phase.id}`} className={`min-h-[44px] text-sm font-medium transition ${phase.done ? 'text-neutral-400' : 'text-emerald-400'}`}>
                  {phase.done ? t('tl.reopen') : t('tl.markDone')}
                </button>
                <LockedZone locked={locked && dated} onBlocked={onBlocked}>
                  <RowDelete name={name} testId={`phase-del-${phase.id}`} onConfirm={onRemove} />
                </LockedZone>
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The sixth circle, "Cronograma": the job as a VERTICAL TIMELINE of phases (no Gantt, no horizontal scroll, built for a phone on OLED black).
 * A continuous line on the left joins the phases; each one is a node. The project's own start and end dates (the ones the card of the main
 * screen counts days with) are DERIVED from the phases: the earliest start and the latest end (lib/phases.js), and are shown under the title.
 */
export default function TimelineBlock({ project, setProject, onBlocked, open, onToggle, now = Date.now() }) {
  const { t, locale } = useI18n();
  const [unfolded, setUnfolded] = useState(null); // accordion: the id of the ONE unfolded phase
  const phases = project.phases ?? [];
  const sorted = sortPhases(phases);
  const locked = Boolean(quoteLock(project.draft));
  const doneCount = phases.filter((p) => p.done).length;
  const days = calendarDays(project);
  const fmt = (iso) => (parseISODay(iso) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseISODay(iso)) : '');
  const span = [fmt(project.startDate), fmt(project.endDate)].filter(Boolean).join(' → ');
  const add = () => {
    const id = newEntryId();
    setProject((p) => withPhaseAdded(p, { id, name: t('tl.defaultName', { n: (p.phases ?? []).length + 1 }) }));
    setUnfolded(id); // the new phase opens at once: its name is the first thing to write
  };
  return (
    <Block icon={<CalendarIcon />} label={t('ws.menu.timeline')} id="timeline" title={t('ws.tl.title')} meta={phases.length ? `${doneCount}/${phases.length}` : ''} open={open} onToggle={onToggle} testId="ws-timeline" tall>
      <div className="space-y-4" data-testid="timeline">
        {span && (
          <p className="text-xs text-neutral-500" data-testid="timeline-span" data-days={days ?? ''}>
            {span}
            {days !== null && ` · ${t(days === 1 ? 'ws.crew.day1' : 'ws.crew.dayN', { n: days })}`}
          </p>
        )}
        {sorted.length === 0 ? (
          <p className="text-sm text-neutral-400" data-testid="timeline-empty">
            {t('tl.empty')}
          </p>
        ) : (
          <ol className="ml-3 border-l-2 border-neutral-800" data-testid="timeline-list">
            {sorted.map((ph) => (
              <PhaseRow
                key={ph.id}
                phase={ph}
                state={phaseState(ph, now)}
                open={unfolded === ph.id}
                locked={locked}
                onBlocked={onBlocked}
                now={now}
                onToggle={() => setUnfolded((id) => (id === ph.id ? null : ph.id))}
                onEdit={(patch) => setProject((p) => withPhaseEdited(p, ph.id, patch))}
                onRemove={() => {
                  setProject((p) => withoutPhase(p, ph.id));
                  setUnfolded(null);
                }}
              />
            ))}
          </ol>
        )}
        {phases.length < PHASE_LIMIT && (
          <button type="button" onClick={add} data-testid="phase-add" className="ml-3 min-h-[44px] pl-6 text-sm font-medium text-emerald-400 transition active:text-emerald-300">
            + {t('tl.add')}
          </button>
        )}
      </div>
    </Block>
  );
}
