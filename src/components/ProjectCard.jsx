import { useMemo } from 'react';
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime, planningTimeline } from '../lib/signature.js';
import { marketBucket } from '../lib/pricing.js';
import { getRegion } from '../lib/regions.js';
import { useProjectBook } from '../lib/usePrices.js';
import { hasRentalDue } from '../lib/ledger.js';
import { isClosed, projectClient, projectLevel, projectTitle } from '../lib/projects.js';
import { LEVEL_COLOR, levelDetail } from './levelStyle.js';
import Hourglass from './Hourglass.jsx';
import { MapPinIcon } from './workspace/icons.jsx';
import WeatherBadge from './WeatherBadge.jsx';
import { useCardWeather } from '../lib/useCardWeather.js';

/**
 * One client job, full width. The WHOLE card is the button (no Open / Edit buttons): a hairline neutral outline and a
 * thick LEFT stripe that is the ONLY thing carrying the state colour, plus the country flag, the days
 * that matter, an hourglass when a rented tool is due back today and, once it lands, the local weather (temperature, sky and a wind
 * warning above 30 km/h).
 */
export default function ProjectCard({ project, now, onOpen, weatherOpts = null }) {
  const { t, lang } = useI18n();
  const region = getRegion(project.draft.regionCode);
  const closed = isClosed(project);
  const info = projectLevel(project, now);
  const level = closed ? 'closed' : info.level;
  const detail = closed ? t('proj.closed') : levelDetail(t, info);
  const rentalDue = !closed && hasRentalDue(project, now);
  // passive weather: never awaited, a closed job has no use for it; with no signal / no place the badge simply does not exist
  const wx = useCardWeather(project, project.draft.regionCode, { ...weatherOpts, ...(closed ? { enabled: false } : {}) });

  // Same inputs as the project screen; it re-prices whenever the market window rolls over (15 min) or the day changes.
  const priceTime = pricingTime(project.draft, now);
  const bucket = marketBucket(priceTime);
  const day = new Date(priceTime).toDateString();
  const book = useProjectBook(project.draft.regionCode, project.location);
  const total = useMemo(() => {
    const r = computeAll(project.draft, priceTime, { timeline: planningTimeline(project.draft, project), book, chains: false });
    return r.valid ? makeI18n(lang, project.draft.regionCode).money(r.quote.total) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.draft, project.startDate, project.endDate, lang, bucket, day, book]);

  const title = projectTitle(project) || t('proj.untitled');
  const client = projectClient(project);
  // the place of the job, to recognise it at a glance: the city / region typed in the project, else the label of its saved point (never bare coordinates)
  const place = String(project.cityOrRegion || project.location?.label || '').trim();

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="project-card"
        data-level={level}
        aria-label={[title, client, detail].filter(Boolean).join(', ')}
        style={{ borderLeftColor: LEVEL_COLOR[level] }}
        className="block w-full rounded-xl border border-l-2 border-white/10 bg-transparent p-4 pl-4 text-left transition active:bg-white/[0.04]"
      >
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-semibold">{title}</span>
            {client && <span className="block truncate text-sm text-neutral-300">{client}</span>}
          </span>
          {/* right column = the ENVIRONMENT (flag, weather, city), aligned to the right edge; the left one is the business (project, client, days) */}
          <span className="flex min-w-0 max-w-[45%] shrink-0 flex-col items-end gap-1 text-right" data-testid="card-env">
            <span className="flex items-start gap-3">
              {rentalDue && <Hourglass label={t('rental.dueToday')} />}
              <WeatherBadge wx={wx} regionCode={project.draft.regionCode} />
              <span className="text-base leading-none" aria-hidden="true" data-testid="card-flag">
                {region?.flag}
              </span>
            </span>
            {place && (
              <span className="flex max-w-full items-center justify-end gap-1 text-xs font-medium text-neutral-400" data-testid="card-place">
                <MapPinIcon size={12} />
                <span className="min-w-0 truncate">{place}</span>
              </span>
            )}
          </span>
        </span>
        <span className="mt-3 flex items-end justify-between gap-3">
          <span
            data-testid="card-detail"
            className={`text-sm font-semibold text-neutral-300 ${level === 'red' ? 'text-base' : ''}`}
          >
            {detail}
          </span>
          {total && <span className="text-base font-medium tabular-nums">{total}</span>}
        </span>
      </button>
    </li>
  );
}
