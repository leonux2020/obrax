import { useMemo } from 'react';
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime, planningTimeline } from '../lib/signature.js';
import { marketBucket } from '../lib/pricing.js';
import { getRegion } from '../lib/regions.js';
import { usePriceBook } from '../lib/usePrices.js';
import { hasRentalDue } from '../lib/ledger.js';
import { isClosed, projectClient, projectLevel, projectTitle } from '../lib/projects.js';
import { LEVEL_COLOR, levelDetail } from './levelStyle.js';
import Hourglass from './Hourglass.jsx';

/**
 * One client job, full width. The WHOLE card is the button (no Open / Edit buttons): a thick bottom border in the
 * state colour, the country flag, the days that matter and an hourglass when a rented tool is due back today.
 */
export default function ProjectCard({ project, now, onOpen }) {
  const { t, lang } = useI18n();
  const region = getRegion(project.draft.regionCode);
  const closed = isClosed(project);
  const info = projectLevel(project, now);
  const level = closed ? 'closed' : info.level;
  const detail = closed ? t('proj.closed') : levelDetail(t, info);
  const rentalDue = !closed && hasRentalDue(project, now);

  // Same inputs as the project screen; it re-prices whenever the market window rolls over (15 min) or the day changes.
  const priceTime = pricingTime(project.draft, now);
  const bucket = marketBucket(priceTime);
  const day = new Date(priceTime).toDateString();
  const book = usePriceBook(project.draft.regionCode);
  const total = useMemo(() => {
    const r = computeAll(project.draft, priceTime, { timeline: planningTimeline(project.draft, project), book, chains: false });
    return r.valid ? makeI18n(lang, project.draft.regionCode).money(r.quote.total) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.draft, project.startDate, project.endDate, lang, bucket, day, book]);

  const title = projectTitle(project) || t('proj.untitled');
  const client = projectClient(project);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="project-card"
        data-level={level}
        aria-label={[title, client, detail].filter(Boolean).join(', ')}
        style={{ borderColor: LEVEL_COLOR[level] }}
        className="block w-full rounded-2xl border-2 border-b-[8px] bg-black p-4 text-left transition active:bg-white/[0.04]"
      >
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-extrabold">{title}</span>
            {client && <span className="block truncate text-sm text-neutral-300">{client}</span>}
          </span>
          {rentalDue && <Hourglass label={t('rental.dueToday')} />}
          <span className="text-base leading-none" aria-hidden="true" data-testid="card-flag">
            {region?.flag}
          </span>
        </span>
        <span className="mt-3 flex items-end justify-between gap-3">
          <span
            data-testid="card-detail"
            className={`text-sm font-bold ${level === 'red' ? 'text-base' : ''}`}
            style={{ color: level === 'closed' || level === 'none' ? '#a3a3a3' : LEVEL_COLOR[level] }}
          >
            {detail}
          </span>
          {total && <span className="text-base font-extrabold tabular-nums">{total}</span>}
        </span>
      </button>
    </li>
  );
}
