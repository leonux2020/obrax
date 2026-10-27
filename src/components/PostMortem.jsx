import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { planningTimeline, pricingTime } from '../lib/signature.js';
import { locationLabel } from '../lib/ledger.js';
import { projectClient, projectTitle } from '../lib/projects.js';
import { postMortem } from '../lib/postMortem.js';
import { partidaGroups } from '../lib/workspaceModel.js';
import { partidaTitle } from '../lib/reports.js';
import { runExport } from '../lib/exportActions.js';
import { useProjectBook } from '../lib/usePrices.js';
import { LEVEL_COLOR } from './levelStyle.js';
import ExportSheet from './workspace/ExportSheet.jsx';

const Stat = ({ id, label, value, tone, hint }) => (
  <div className="rounded-xl border border-white/10 p-3">
    <p className="text-xs font-semibold text-[#E0E0E0]/70">{label}</p>
    <p data-testid={id} className="mt-0.5 break-words text-xl font-black tabular-nums" style={tone ? { color: tone } : undefined}>
      {value}
    </p>
    {hint && <p className="mt-0.5 text-xs text-[#E0E0E0]/60">{hint}</p>}
  </div>
);

const Section = ({ title, children, testId }) => (
  <section data-testid={testId} className="rounded-xl border border-l-2 border-white/10 border-l-white/30 p-3">
    <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#E0E0E0]/80">{title}</h2>
    {children}
  </section>
);

/**
 * "Dashboard Post-Mortem": what a FINISHED project (closedAt > 0) shows instead of the living list. Read-only on purpose: no
 * input, no slider, no numpad. Balance (budgeted vs collected vs real profit), time (estimated vs real days per the
 * logbook), the quote's items and the logbook notes. At the end, "Crear extensión" starts a new phase of the same job.
 * The only actions are buttons: back, export, reopen and create extension.
 */
export default function PostMortem({ project, parent = null, company, photos, setDraft, onBack, onReopen, onExtend }) {
  const i18n = useI18n();
  const { t, money, num, unit, locale, region } = i18n;
  const draft = project.draft;
  const regionCode = draft.regionCode;
  const [exporting, setExporting] = useState(false);
  const book = useProjectBook(regionCode, project.location);
  const priceTime = pricingTime(draft, project.closedAt); // priced as of the day it was finished
  const timeline = planningTimeline(draft, project);
  const result = useMemo(
    () => computeAll(draft, priceTime, { timeline, book, chains: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, priceTime, timeline.startDate, timeline.endDate, book]
  );
  const total = result.valid ? result.quote.total : 0;
  const pm = useMemo(() => postMortem(project, { total, result, timeline }), [project, total, result, timeline]);
  const groups = useMemo(() => partidaGroups(result, draft), [result, draft]);
  const date = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const where = locationLabel(project.location);
  const title = projectTitle(project) || t('proj.untitled');
  const good = '#7fd69a';
  const delta = pm.days.delta;
  const deltaText = delta === null ? '' : delta === 0 ? t('pm.delta.same') : delta < 0 ? t('pm.delta.early', { n: num(-delta, 0) }) : t('pm.delta.late', { n: num(delta, 0) });
  const log = [...(project.logbook ?? [])].sort((a, b) => b.at - a.at);

  const exportDoc = (kind) => runExport(kind, { project, result, total, priceTime, company, photos, i18n, setDraft }); // the sheet shows the error
  const reopen = () => {
    if (window.confirm(t('pm.reopen.confirm'))) onReopen();
  };

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl bg-black pb-16 text-[#E0E0E0]" data-testid="project-postmortem">
      <header data-testid="ws-zone-a" className="sticky top-0 z-20 border-b border-white/10 bg-black px-3 pb-3 pt-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} aria-label={t('common.back')} data-testid="ws-back" className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-3xl font-light leading-none text-[#E0E0E0] active:opacity-50">
            <span aria-hidden="true">←</span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 data-testid="ws-title" className="truncate text-xl font-extrabold leading-tight">
              {title}
            </h1>
            <p className="truncate text-sm text-[#E0E0E0]/80">
              <span aria-hidden="true">{region.flag}</span> {projectClient(project) || t('proj.noClient')}
              <span className="text-[#E0E0E0]/50"> · </span>
              <span>{where || t('ws.noLocation')}</span>
            </p>
          </div>
        </div>
        <p data-testid="pm-closed" className="mt-2 border-l-2 pl-2 text-sm font-extrabold" style={{ borderLeftColor: LEVEL_COLOR.closed, color: LEVEL_COLOR.closed }}>
          {t('proj.closed')} · {t('pm.closedOn', { date: date(project.closedAt) })}
          {parent && (
            <span data-testid="pm-parent" className="block text-xs font-semibold text-[#E0E0E0]/70">
              {t('pm.extOf', { name: projectTitle(parent) || t('proj.untitled') })}
            </span>
          )}
        </p>
      </header>

      <div className="space-y-3 px-3 pt-3">
        <Section title={t('pm.balance')} testId="pm-balance">
          <div className="grid grid-cols-2 gap-2">
            <Stat id="pm-budget" label={t('pm.budget')} value={pm.budget > 0 ? money(pm.budget) : '—'} />
            <Stat id="pm-collected" label={t('pm.collected')} value={money(pm.collected)} hint={pm.budget > 0 ? `${Math.round(pm.collectedPct)} %` : ''} />
            <Stat id="pm-spent" label={t('pm.spent')} value={money(pm.spent)} />
            <Stat
              id="pm-profit"
              label={t('pm.profit')}
              value={money(pm.profit)}
              tone={pm.profit < 0 ? LEVEL_COLOR.red : pm.profit > 0 ? good : undefined}
              hint={pm.margin === null ? '' : t('pm.margin', { pct: `${num(pm.margin, 1)} %` })}
            />
          </div>
          {pm.pending > 0 && (
            <p className="mt-2 text-xs text-[#E0E0E0]/70" data-testid="pm-pending">
              {t('cash.pending')}: <b className="tabular-nums text-[#E0E0E0]">{money(pm.pending)}</b>
            </p>
          )}
        </Section>

        <Section title={t('pm.time')} testId="pm-time">
          <div className="grid grid-cols-2 gap-2">
            <Stat id="pm-days-est" label={t('pm.estimated')} value={pm.days.estimated === null ? '—' : num(pm.days.estimated, 0)} />
            <Stat id="pm-days-act" label={t('pm.actual')} value={pm.days.actual === null ? '—' : num(pm.days.actual, 0)} hint={t(pm.days.source === 'log' ? 'pm.actual.log' : 'pm.actual.dates')} />
          </div>
          {deltaText && (
            <p data-testid="pm-delta" data-delta={delta} className="mt-2 border-l-2 pl-2 text-sm font-bold" style={{ borderLeftColor: delta > 0 ? LEVEL_COLOR.red : good, color: delta > 0 ? LEVEL_COLOR.red : good }}>
              {deltaText}
            </p>
          )}
        </Section>

        <Section title={t('pm.items')} testId="pm-items">
          {groups.length === 0 ? (
            <p className="text-sm text-[#E0E0E0]/60">{t('pm.noItems')}</p>
          ) : (
            <ul className="space-y-3">
              {groups.map((g, i) => (
                <li key={g.id}>
                  <p className="flex items-baseline justify-between gap-3 text-sm font-bold">
                    <span className="min-w-0 flex-1 truncate">{partidaTitle(draft.partidas[i], t)}</span>
                    <span className="tabular-nums">{g.incomplete ? '—' : money(g.amount)}</span>
                  </p>
                  {g.rows.length > 0 && (
                    <ul className="mt-1 divide-y divide-white/10 border-l border-white/10 pl-3">
                      {g.rows.map((r) => (
                        <li key={r.id} className="flex items-baseline justify-between gap-3 py-1 text-xs text-[#E0E0E0]/80">
                          <span className="min-w-0 flex-1 truncate">
                            {t(`mat.${r.id}`)} · {num(r.packs)} {unit(r.saleUnit)}
                          </span>
                          <span className="tabular-nums">{money(r.total)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`${t('pm.log')} (${pm.logbookCount})`} testId="pm-log">
          {log.length === 0 ? (
            <p className="text-sm text-[#E0E0E0]/60">{t('pm.logEmpty')}</p>
          ) : (
            <ul className="divide-y divide-white/10">
              {log.map((e) => (
                <li key={e.id} className="py-2">
                  <p className="text-xs font-semibold text-[#E0E0E0]/60">{date(e.at)}</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{e.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={onExtend}
            data-testid="pm-extension"
            className="flex min-h-[64px] w-full select-none flex-col items-center justify-center rounded-2xl border-2 border-brand bg-black px-5 text-lg font-extrabold text-brand transition active:scale-[0.98]"
          >
            {t('pm.extension')}
            <span className="text-xs font-semibold text-[#E0E0E0]/70">{t('pm.extension.hint')}</span>
          </button>
          <button type="button" onClick={() => setExporting(true)} data-testid="pm-export" className="min-h-[48px] w-full rounded-xl border border-white/15 text-sm font-bold text-[#E0E0E0]/80 active:border-white/50">
            {t('pm.export')}
          </button>
          <button type="button" onClick={reopen} data-testid="pm-reopen" className="min-h-[44px] w-full text-xs font-bold text-[#E0E0E0]/60 active:text-[#E0E0E0]">
            {t('pm.reopen')}
          </button>
        </div>
      </div>

      {exporting && <ExportSheet canPdf={result.valid} onExport={exportDoc} onClose={() => setExporting(false)} />}
    </main>
  );
}
