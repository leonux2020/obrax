import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { isClosed, projectLevel, sortProjects } from '../lib/projects.js';
import { usePro } from '../lib/usePro.js';
import { Logo, Wordmark } from './ui.jsx';
import HelmetIcon from './HelmetIcon.jsx';
import { LEVEL_COLOR } from './levelStyle.js';
import ProjectCard from './ProjectCard.jsx';
import ProQaTag from './ProQaTag.jsx';

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
      <header className="mb-2 flex items-center gap-3">
        {/* isotype (32 px tall) + name, aligned on one line */}
        <Logo size={32} />
        <span className="sr-only">{t('app.name')}</span>
        <span className="flex min-w-0 flex-1 items-center">
          <Wordmark height={16} />
        </span>
        {/* PRO: always a real button that opens the plans screen (also when PRO is already active). Gold hard hat on top. */}
        <button
          type="button"
          onClick={() => onPro()}
          data-testid={pro ? 'pro-active' : 'pro-scan'}
          data-pro={pro ? 'true' : undefined}
          aria-label={pro ? t('pro.active') : t('pro.cta')}
          className={`flex min-h-[52px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-1 transition-shadow duration-200 hover:shadow-[0_0_14px_rgba(212,175,55,0.5)] focus-visible:shadow-[0_0_14px_rgba(212,175,55,0.5)] active:shadow-[0_0_18px_rgba(232,195,95,0.6)] ${
            pro ? 'border-[#d4af37]/60 text-[#e8c35f]' : 'border-white/15 text-white/60 hover:border-[#d4af37]/70 hover:text-[#e8c35f]'
          }`}
        >
          <HelmetIcon size={28} />
          <span className="text-[11px] font-extrabold leading-none tracking-widest">PRO</span>
        </button>
      </header>
      <h1 className="mb-1 truncate text-2xl font-extrabold tracking-tight">{t('nav.projects')}</h1>
      <p className="mb-3 min-h-[12px]">
        <ProQaTag />
      </p>

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
                  <span aria-hidden="true" className="absolute inset-x-0 top-[25px] text-center text-xl font-black leading-none tabular-nums" style={{ color }}>
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
