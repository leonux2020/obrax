import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sortProjects, trafficLight } from '../lib/projects.js';
import { Button } from './ui.jsx';
import HelmetIcon from './HelmetIcon.jsx';
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

/** Main view: one card per client job, most urgent first. Bottom padding leaves room for the BottomNav. */
export default function Dashboard({ projects, companyMissing, onNew, onOpen, onEdit, onSettings, onPro }) {
  const { t } = useI18n();
  const now = useNow();
  const sorted = useMemo(() => sortProjects(projects, now), [projects, now]);
  const counts = useMemo(() => {
    const c = { red: 0, orange: 0, green: 0 };
    for (const p of projects) {
      const level = trafficLight(p.startDate, p.endDate, now).level;
      if (level in c) c[level] += 1;
    }
    return c;
  }, [projects, now]);

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-32 pt-4 sm:px-4">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('dash.title')}</h1>
      {projects.length > 0 && (
        <p className="mb-4 mt-1 text-sm text-neutral-300" data-testid="dash-summary">
          {t('dash.summary', { late: counts.red, soon: counts.orange, ok: counts.green })}
        </p>
      )}

      {/* PRO hook (freemium): a discreet gold-outlined button on pure black that opens the benefits screen. */}
      <button
        type="button"
        onClick={onPro}
        data-testid="pro-scan"
        className="mb-4 flex min-h-[56px] w-full items-center justify-center gap-3 rounded-xl border border-[#d4af37]/60 px-4 text-base font-bold text-[#e8c35f] transition hover:border-[#d4af37] active:scale-[0.99]"
      >
        <HelmetIcon size={28} />
        <span>{t('pro.cta')}</span>
      </button>

      {companyMissing && (
        <section className="mb-4 rounded-2xl border border-white/10 bg-black p-4" data-testid="company-hint">
          <p className="text-sm text-neutral-200">{t('dash.companyHint')}</p>
          <Button variant="secondary" className="mt-3 w-full !min-h-[48px] text-sm" onClick={onSettings}>
            {t('nav.settings')}
          </Button>
        </section>
      )}

      {projects.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-white/10 bg-black p-6 text-center" data-testid="dash-empty">
          <h2 className="text-xl font-bold">{t('dash.empty.title')}</h2>
          <p className="mx-auto mb-5 mt-2 max-w-sm text-neutral-300">{t('dash.empty.desc')}</p>
          <Button className="w-full" onClick={onNew}>
            {t('dash.empty.cta')}
          </Button>
        </section>
      ) : (
        <ul className="space-y-3" aria-label={t('dash.title')}>
          {sorted.map((p) => (
            <ProjectCard key={p.id} project={p} now={now} onOpen={() => onOpen(p.id)} onEdit={() => onEdit(p.id)} />
          ))}
        </ul>
      )}
    </main>
  );
}
