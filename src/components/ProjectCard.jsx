import { useMemo } from 'react';
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime } from '../lib/signature.js';
import { getRegion } from '../lib/regions.js';
import { parseDay, projectClient, projectTitle, trafficLight } from '../lib/projects.js';
import TrafficLight from './TrafficLight.jsx';

/** One client job. Whole body opens the project; the footer row holds the two actions (thumb zone). */
export default function ProjectCard({ project, now, onOpen, onEdit }) {
  const { t, lang, locale } = useI18n();
  const region = getRegion(project.draft.regionCode);
  const light = trafficLight(project.startDate, project.endDate, now);

  const total = useMemo(() => {
    const r = computeAll(project.draft, pricingTime(project.draft, now));
    return r.valid ? makeI18n(lang, project.draft.regionCode).money(r.quote.total) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.draft, lang]);

  const fmt = (iso) => {
    const d = parseDay(iso);
    return d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d) : '';
  };
  const title = projectTitle(project) || t('proj.untitled');
  const client = projectClient(project) || t('proj.noClient');
  const dates =
    project.startDate && project.endDate
      ? `${fmt(project.startDate)} → ${fmt(project.endDate)}`
      : project.endDate
        ? `→ ${fmt(project.endDate)}`
        : t('proj.noDates');
  const items = project.draft.partidas.length;

  return (
    <li>
      <article className="overflow-hidden rounded-2xl border border-white/10 bg-black" data-testid="project-card" data-level={light.level}>
        <button type="button" onClick={onOpen} className="block w-full p-4 text-left active:bg-black sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-extrabold">{title}</h3>
              <p className="truncate text-sm text-neutral-300">{client}</p>
            </div>
            <span className="text-2xl leading-none" aria-hidden="true">
              {region?.flag}
            </span>
          </div>
          <div className="mt-3">
            <TrafficLight light={light} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-neutral-300">
            <dd className="col-span-2 truncate">{dates}</dd>
            <dd>{t('proj.partidas', { n: items })}</dd>
            {total && <dd className="text-right font-bold text-white">{total}</dd>}
          </dl>
          {project.company.name && <p className="mt-2 truncate text-xs text-neutral-400">{t('proj.issuedBy', { name: project.company.name })}</p>}
        </button>
        <div className="grid grid-cols-2 border-t border-white/10">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${t('proj.edit')}: ${title}`}
            className="min-h-[52px] border-r border-white/10 text-sm font-bold text-neutral-200 hover:text-brand"
          >
            {t('proj.edit')}
          </button>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${t('proj.open')}: ${title}`}
            className="min-h-[52px] text-sm font-bold text-brand hover:text-brand-light"
          >
            {t('proj.open')} →
          </button>
        </div>
      </article>
    </li>
  );
}
