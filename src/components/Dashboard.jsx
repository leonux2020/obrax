import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { isClosed, projectLevel, sortProjects } from '../lib/projects.js';
import { usePro } from '../lib/usePro.js';
import { Logo } from './ui.jsx';
import { LEVEL_COLOR } from './levelStyle.js';
import ProjectCard from './ProjectCard.jsx';

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
export default function Dashboard({ projects, tab, onTab, onNew, onOpen, onPro }) {
  const pro = usePro();
  const { t } = useI18n();
  const now = useNow();

  const { active, history } = useMemo(() => {
    const a = [];
    const h = [];
    for (const p of projects) (isClosed(p) ? h : a).push(p);
    return { active: sortProjects(a, now), history: [...h].sort((x, y) => y.closedAt - x.closedAt) };
  }, [projects, now]);

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
      <header className="mb-3 flex items-center gap-3">
        <Logo size={34} />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{t('nav.projects')}</h1>
        {pro ? (
          <span role="status" data-testid="pro-active" aria-label={t('pro.active')} className="rounded-md border border-[#d4af37]/60 px-2 py-0.5 text-[11px] font-extrabold tracking-widest text-[#e8c35f]">
            PRO
          </span>
        ) : (
          <button
            type="button"
            onClick={onPro}
            data-testid="pro-scan"
            aria-label={t('pro.cta')}
            className="min-h-[32px] rounded-md border border-white/15 px-2 text-[11px] font-extrabold tracking-widest text-white/50 transition hover:border-[#d4af37] hover:text-[#e8c35f]"
          >
            PRO
          </button>
        )}
      </header>

      {active.length > 0 && (
        <ul className="mb-3 grid grid-cols-4 gap-1.5" data-testid="dash-pills" aria-label={t('light.label')}>
          {PILLS.map(([level, key]) => (
            <li
              key={level}
              data-testid={`pill-${level}`}
              data-count={counts[level]}
              aria-label={`${t(key)}: ${counts[level]}`}
              className={`flex flex-col items-center rounded-xl border border-white/10 px-1 py-1.5 ${counts[level] ? '' : 'opacity-40'}`}
            >
              <span className="flex items-center gap-1.5 text-lg font-extrabold tabular-nums leading-none">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
                {counts[level]}
              </span>
              <span className="mt-1 max-w-full truncate text-[10px] font-semibold text-neutral-300">{t(key)}</span>
            </li>
          ))}
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
            className={`min-h-[48px] border-b-2 text-base font-bold transition ${tab === id ? 'border-brand text-white' : 'border-transparent text-neutral-400 hover:text-white'}`}
          >
            {t(key)} <span className="text-sm font-semibold text-neutral-400">{n}</span>
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
        className="no-print fixed right-4 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-black shadow-[0_0_24px_rgba(34,197,94,0.35)] transition active:scale-95 [bottom:calc(5.5rem+env(safe-area-inset-bottom))]"
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </main>
  );
}
