import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { projectAlerts } from '../lib/alerts.js';
import { projectTotal } from '../lib/projectTotals.js';
import { projectMarket } from '../lib/ledger.js';
import { isClosed, projectLevel, projectTitle, sortProjects } from '../lib/projects.js';
import { usePro } from '../lib/usePro.js';
import { Logo, Wordmark } from './ui.jsx';
import BackupBadge from './BackupBadge.jsx';
import HelmetIcon from './HelmetIcon.jsx';
import { LEVEL_COLOR } from './levelStyle.js';
import ProjectCard from './ProjectCard.jsx';
import GlobalAlerts from './GlobalAlerts.jsx';
import { BellIcon } from './workspace/icons.jsx';

/** Re-render once a minute (and when the tab becomes visible) so the traffic lights never go stale. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);
  return now;
}

const EMPTY_TRIANGLE = '#737373'; // neutral grey for a counter that is 0

const PILLS = [
  ['red', 'pill.late'],
  ['orange', 'pill.soon'],
  ['green', 'pill.ok'],
  ['future', 'pill.future'],
];

/**
 * Main view. Header (logo + "Proyectos" on one line, a discreet PRO badge), four colour counters instead of a
 * sentence, the Activos / Historial tabs and one full-width card per job. "Nuevo proyecto" is the FAB.
 */
export default function Dashboard({ projects, tab, onTab, onNew, onOpen, onPro, receiptRows = [] }) {
  const pro = usePro();
  const { t, moneyIn } = useI18n();
  const now = useNow();
  const [alertsOpen, setAlertsOpen] = useState(false);

  const { active, history } = useMemo(() => {
    const a = [];
    const h = [];
    for (const p of projects) (isClosed(p) ? h : a).push(p);
    return { active: sortProjects(a, now), history: [...h].sort((x, y) => y.closedAt - x.closedAt) };
  }, [projects, now]);

  // the Action Center: every real exception of every open project (overdue deadline, late collection, rental due, receipt to review);
  // none => the quiet "no alarms" screen. The budget comes from the same engine the project screens use.
  const alerts = useMemo(
    () =>
      active.flatMap((p) => {
        const total = projectTotal(p, now);
        const currency = projectMarket(p).currency;
        return projectAlerts(p, t, { now, budget: total, queue: receiptRows, money: (n) => moneyIn(n, currency) }).map((a) => ({ ...a, id: `${p.id}:${a.id}`, projectId: p.id, project: projectTitle(p) || t('proj.untitled') }));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, t, now, receiptRows]
  );

  const counts = useMemo(() => {
    const c = { red: 0, orange: 0, green: 0, future: 0 };
    for (const p of active) {
      const level = projectLevel(p, now).level;
      if (level in c) c[level] += 1;
    }
    return c;
  }, [active, now]);

  const shown = tab === 'history' ? history : active;

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-44 pt-3 sm:px-4">
      <header className="mb-2 flex items-center gap-2" data-testid="dash-header">
        {/* ultra-compact top bar: isotype (24 px = h-6) + name, bell and PRO on ONE thin line */}
        <Logo size={24} />
        <span className="sr-only">{t('app.name')}</span>
        <span className="flex min-w-0 flex-1 items-center">
          <Wordmark height={13} />
        </span>
        <BackupBadge />
        {/* global alerts (Action Center): bell, 1.5 px outline, just left of PRO, floating (no box, no border, no background: only an invisible 52 px touch area); an amber dot only when something needs attention */}
        <button
          type="button"
          onClick={() => setAlertsOpen(true)}
          aria-label={t('ws.alerts.title')}
          data-testid="dash-bell"
          data-alerts={alerts.length || undefined}
          className="relative flex min-h-[44px] min-w-[44px] items-center justify-center bg-transparent p-2 text-neutral-400 transition active:scale-95 active:text-neutral-200 active:opacity-50"
        >
          <BellIcon size={24} />
          {alerts.length > 0 && <span aria-hidden="true" data-testid="dash-bell-dot" className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-amber-500" />}
        </button>
        {/* PRO: always a real button that opens the plans screen (also when PRO is already active). Titanium / silver hard hat + label side by side: a slim pill (36 px) inside a 44 px touch area. */}
        <button
          type="button"
          onClick={() => onPro()}
          data-testid={pro ? 'pro-active' : 'pro-scan'}
          data-pro={pro ? 'true' : undefined}
          aria-label={pro ? t('pro.active') : t('pro.cta')}
          className="group flex min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <span
            data-testid="pro-pill"
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 transition-shadow duration-200 group-hover:shadow-[0_0_12px_rgba(203,213,225,0.35)] group-focus-visible:shadow-[0_0_12px_rgba(203,213,225,0.35)] group-active:shadow-[0_0_16px_rgba(226,232,240,0.45)] ${
              pro ? 'border-slate-500/50 text-slate-300' : 'border-white/15 text-neutral-400 group-hover:border-slate-400/70 group-hover:text-slate-300'
            }`}
          >
            <HelmetIcon size={20} />
            <span className="text-xs font-semibold leading-none">PRO</span>
          </span>
        </button>
      </header>
      {/* no visible title and no "MODO PRO (Prueba)" tag: top bar (logo + PRO) and, right below, the four triangles. The heading stays for screen readers. */}
      <h1 className="sr-only">{t('nav.projects')}</h1>

      {active.length > 0 && (
        <ul className="mb-3 flex items-center justify-around" data-testid="dash-pills" aria-label={t('light.label')}>
          {PILLS.map(([level, key]) => {
            const n = counts[level];
            const color = LEVEL_COLOR[level];
            // zero state: an EMPTY, dimmed outline (no number, neutral colour, low opacity) so it does not compete for attention
            const stroke = n > 0 ? color : EMPTY_TRIANGLE;
            return (
              <li key={level} data-testid={`pill-${level}`} data-count={n} data-empty={n > 0 ? undefined : 'true'} aria-label={`${t(key)}: ${n}`} title={t(key)} className="relative block h-[54px] w-[60px]">
                {/* warning-sign triangle: transparent / OLED black inside; vivid state colour + number when > 0, empty and dimmed at 0 */}
                <svg viewBox="0 0 60 54" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false" style={n > 0 ? { filter: `drop-shadow(0 0 5px ${color}66)` } : undefined}>
                  <polygon points="30,3 57,51 3,51" fill="none" stroke={stroke} strokeWidth="2" strokeOpacity={n > 0 ? 1 : 0.28} strokeLinejoin="round" data-testid={`tri-${level}`} />
                </svg>
                {n > 0 && (
                  <span aria-hidden="true" className="absolute inset-x-0 top-[25px] text-center text-xl font-medium leading-none tabular-nums" style={{ color }}>
                    {n}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div role="tablist" aria-label={t('nav.projects')} className="mb-3 grid grid-cols-2 border-b border-white/10">
        {[
          ['active', 'dash.tab.active', active.length],
          ['history', 'dash.tab.history', history.length],
        ].map(([id, key, n]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => onTab(id)}
            className={`min-h-[48px] border-b-2 text-base font-semibold transition ${
              tab === id
                ? `text-neutral-200 ${id === 'history' ? 'border-neutral-500' : 'border-brand'}` // Activos: green; Historial: cement grey (closed work is not "go")
                : 'border-transparent text-neutral-500 hover:text-neutral-300' // the section you are NOT in is dimmed
            }`}
          >
            {t(key)} <span className={`text-sm font-semibold ${tab === id ? 'text-neutral-400' : 'text-neutral-500'}`}>{n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-neutral-400" data-testid="dash-empty">
          {t(tab === 'history' ? 'dash.empty.history' : 'dash.empty.active')}
        </p>
      ) : (
        <ul className="space-y-3" aria-label={t(tab === 'history' ? 'dash.tab.history' : 'dash.tab.active')}>
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} now={now} onOpen={() => onOpen(p.id)} />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onNew}
        data-testid="fab-new"
        aria-label={t('dash.new')}
        className="no-print fixed right-3 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand-dark text-black shadow-[0_2px_10px_rgba(22,163,74,0.22)] transition active:scale-95 [bottom:calc(5.25rem+env(safe-area-inset-bottom))]"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {alertsOpen && (
        <GlobalAlerts
          alerts={alerts}
          onClose={() => setAlertsOpen(false)}
          onOpen={(id) => {
            setAlertsOpen(false);
            onOpen(id);
          }}
        />
      )}
    </main>
  );
}
