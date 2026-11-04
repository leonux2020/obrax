import { useMemo, useState } from 'react';
import BackupBadge from './BackupBadge.jsx';
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { useMarketClock } from '../lib/marketClock.js';
import { projectBalance } from '../lib/rendition.js';
import { UI_WATCHDOG_MS, settleWithin } from '../lib/exportSync.js';
import {
  collectionDelay,
  daysAgo,
  getLastProjectActivity,
  globalBreakdown,
  globalSupplierShares,
  projectDateRange,
  projectLiquidity,
  sortByActivity,
} from '../lib/ledger.js';
import GlobalBreakdownSheet from './GlobalBreakdownSheet.jsx';
import DonutChart from './DonutChart.jsx';
import { projectClient, projectTitle } from '../lib/projects.js';
import { projectTotals } from '../lib/projectTotals.js';
import { usePriceVersion } from '../lib/usePrices.js';
import { Button } from './ui.jsx';

/**
 * "Contabilidad Global": every project with its cash balance (collected - expenses - advances). Tick several and
 * one tap sends a single consolidated Excel to Drive (Rendiciones_Globales) or, offline, to the export queue; it is never downloaded.
 *
 * Above the list ONE metric: DISPONIBLE (real liquid cash, large and centred) over the ACTIVE projects, one line per currency; each card
 * shows its dates and last-activity pulse, the list is ordered by last movement, and an overdrawn project gets an amber edge.
 * Everything is deduced from the records already stored (nothing new is saved).
 */
const AMBER = 'text-[#e8c35f]';

/** Font size by length of the amount, so the figure always fits INSIDE the hole of the ring (never wraps or clips, 320 px screens included). */
const sizeFor = (text) => (text.length <= 8 ? 'text-3xl' : text.length <= 10 ? 'text-2xl' : text.length <= 13 ? 'text-xl' : 'text-lg');

/** Solid, sober segment colours (greens, greys, a dark orange); the folded "others" take the darkest grey. */
const SEGMENT_COLORS = ['#22c55e', '#9ca3af', '#c2410c', '#166534'];
const OTHERS_COLOR = '#52525b';

/**
 * ONE metric per currency: the DONUT. Its ring splits the global expenses by supplier; in its hollow centre sits DISPONIBILE (real liquid cash:
 * collected - expenses - advances), large, green when positive. Under the ring an ultra-minimal legend names the main suppliers with their %.
 * Currencies are never mixed: each one gets its own ring.
 */
function DonutBlock({ currency, liquid, shares, many, fmt, label }) {
  const { t } = useI18n();
  const text = fmt(liquid);
  const segments = (shares?.segments ?? []).map((s, i) => ({ ...s, color: s.others ? OTHERS_COLOR : SEGMENT_COLORS[i % SEGMENT_COLORS.length], label: s.others ? t('acc.donut.others') : s.name || t('exp.noSupplier') }));
  return (
    <div data-testid={`acc-donut-block-${currency}`} className="min-w-0">
      {many && <p className="mb-1 text-center text-xs font-medium tabular-nums text-neutral-400">{currency}</p>}
      <DonutChart segments={segments} size={224} testId={`acc-donut-${currency}`} label={`${t('acc.donut.aria')} ${currency}`}>
        <span className="block whitespace-nowrap text-xs font-medium uppercase text-neutral-400">{label}</span>
        <span
          data-testid={`acc-liquid-${currency}`}
          className={`mt-0.5 block whitespace-nowrap font-medium tracking-tight tabular-nums ${sizeFor(text)} ${liquid < 0 ? AMBER : liquid > 0 ? 'text-brand' : 'text-neutral-200'}`}
        >
          {text}
        </span>
      </DonutChart>
      {segments.length === 0 ? (
        <p data-testid={`acc-legend-${currency}`} className="mt-3 text-center text-xs text-neutral-500">
          {t('acc.donut.none')}
        </p>
      ) : (
        <ul data-testid={`acc-legend-${currency}`} aria-label={t('exp.byVendor')} className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {segments.map((s) => (
            <li key={s.key} data-testid={`acc-legend-item-${s.key}`} className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-400">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="max-w-[8rem] truncate">{s.label}</span>
              <span className="tabular-nums">{Math.round(s.pct)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GlobalAccounting({ projects, onOpenProject = null, onExportGlobal = null, watchdogMs = UI_WATCHDOG_MS }) {
  const { t, lang, locale } = useI18n();
  const { now } = useMarketClock();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const priceVersion = usePriceVersion(); // live prices landing re-total the projects
  const totals = useMemo(() => projectTotals(projects, now), [projects, now, priceVersion]);
  const rows = useMemo(
    () =>
      projects.map((p) => ({
        project: p,
        balance: projectBalance(p, totals.get(p.id)),
        fmt: makeI18n(lang, p.draft.regionCode).money,
      })),
    [projects, totals, lang],
  );
  const sorted = useMemo(() => {
    const byId = new Map(rows.map((x) => [x.project.id, x]));
    return sortByActivity(projects).map((p) => byId.get(p.id));
  }, [projects, rows]);
  const breakdown = useMemo(() => globalBreakdown(projects, totals), [projects, totals]);
  const shares = useMemo(() => new Map(globalSupplierShares(projects).map((x) => [x.currency, x])), [projects]);
  const [open, setOpen] = useState(false);
  const moneyOf = useMemo(() => {
    const cache = new Map();
    return (code) => cache.get(code) ?? (cache.set(code, makeI18n(lang, code).money), cache.get(code));
  }, [lang]);
  const pulseOf = (p) => {
    const days = daysAgo(getLastProjectActivity(p), now);
    if (days === null) return t('acc.active.none');
    return days === 0 ? t('acc.active.today') : days === 1 ? t('acc.active.yesterday') : t('acc.active.days', { n: days });
  };
  const datesOf = (p) => {
    const range = projectDateRange(p, locale);
    return range.kind === 'created' ? t('acc.created', { date: range.text }) : range.text;
  };
  const all = projects.length > 0 && selected.length === projects.length;
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // The consolidated Excel goes to Drive (CUBRAX - Respaldos Obra / Rendiciones_Globales) or, offline, to the export queue: it is never downloaded.
  // The parent decides the outcome and shows its toast; here the button is ALWAYS released (finally), even if the delivery throws or hangs.
  const exportGlobal = async () => {
    const ids = projects.filter((p) => selected.includes(p.id)).map((p) => p.id);
    if (!ids.length || busy || !onExportGlobal) return;
    setBusy(true);
    setNote('');
    try {
      await settleWithin(onExportGlobal(ids), watchdogMs);
    } catch {
      setNote('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-28 pt-3 sm:px-4" data-testid="accounting">
      <header className="mb-2 flex min-h-[44px] items-center gap-2" data-testid="acc-header">
        {/* no visible title: the bottom nav already says where you are (the heading stays for screen readers) */}
        <h1 className="sr-only">{t('nav.accountingShort')}</h1>
        <span className="flex-1" />
        <BackupBadge />
      </header>

      {projects.length === 0 ? (
        <p className="mt-10 text-center text-neutral-400" data-testid="acc-empty">
          {t('acc.empty')}
        </p>
      ) : (
        <>
          <button
            type="button"
            data-testid="acc-hud"
            onClick={() => setOpen(true)}
            aria-label={`${t('acc.sheet.open')}: ${t('acc.hud')}`}
            aria-haspopup="dialog"
            // floating chart: NO box around it (no border, background, ring, shadow or rounded corners): the ring floats on the OLED black
            className="mb-2 block w-full cursor-pointer px-3 py-3 text-center transition-opacity active:opacity-80"
          >
            <span data-testid="acc-liquid" className="block space-y-6">
              {breakdown.length === 0 ? (
                <DonutBlock currency="—" liquid={0} shares={null} many={false} fmt={() => '—'} label={t('acc.hud.liquid')} />
              ) : (
                breakdown.map((l) => (
                  <DonutBlock key={l.currency} currency={l.currency} liquid={l.liquid} shares={shares.get(l.currency)} many={breakdown.length > 1} fmt={moneyOf(l.regionCode)} label={t('acc.hud.liquid')} />
                ))
              )}
            </span>
          </button>
          {open && (
            <GlobalBreakdownSheet breakdown={breakdown} moneyOf={moneyOf} onClose={() => setOpen(false)} />
          )}
          {/* solid, static export button: part of the page flow (right under the chart, above the list), so it can never cover text while scrolling */}
          <div className="no-print mb-2" data-testid="acc-export-bar">
            {note === 'error' && (
              <p role="alert" className="mb-2 text-sm font-semibold text-red-400">
                {t('xl.error')}
              </p>
            )}
            <Button className="w-full" disabled={selected.length === 0 || busy} onClick={exportGlobal} data-testid="acc-export">
              {busy ? t('pdf.generating') : t('acc.export', { n: selected.length })}
            </Button>
          </div>
          {/* "Tutti" / "Ninguno": a discreet chip right above the list it controls (the checkboxes), a 44 px invisible touch area around the pill */}
          <button type="button" onClick={() => setSelected(all ? [] : projects.map((p) => p.id))} data-testid="acc-all" className="mb-0.5 flex min-h-[44px] items-center px-1 active:opacity-70">
            <span data-testid="acc-all-chip" className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-400">
              {t(all ? 'acc.none' : 'acc.all')}
            </span>
          </button>
          <ul className="space-y-2" aria-label={t('nav.accounting')}>
            {sorted.map(({ project: p, balance: b, fmt }) => {
              const on = selected.includes(p.id);
              const overdrawn = projectLiquidity(p) < 0;
              const late = collectionDelay(p, totals.get(p.id), now);
              return (
                <li key={p.id}>
                  {/* two separate gestures: the CHECKBOX alone picks the project for the consolidated Excel; the body of the card opens its financial command center */}
                  <div
                    data-testid={`acc-row-${p.id}`}
                    data-overdrawn={overdrawn ? 'true' : undefined}
                    className={`flex min-h-[72px] items-stretch rounded-2xl border border-l-2 bg-black transition ${on ? 'border-brand' : 'border-white/10'} ${overdrawn ? 'border-l-[#e8c35f]' : ''}`}
                  >
                    <label className="flex w-14 shrink-0 cursor-pointer items-center justify-center rounded-l-2xl" data-testid={`acc-select-${p.id}`}>
                      <input
                        type="checkbox"
                        className="h-6 w-6 shrink-0 accent-[#22c55e]"
                        checked={on}
                        onChange={() => toggle(p.id)}
                        aria-label={projectTitle(p) || t('proj.untitled')}
                        data-testid={`acc-check-${p.id}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => onOpenProject?.(p.id, { fromAccounting: true })}
                      aria-label={t('fin.open', { name: projectTitle(p) || t('proj.untitled') })}
                      data-testid={`acc-open-${p.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-r-2xl py-3 pr-4 text-left active:opacity-80"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{projectTitle(p) || t('proj.untitled')}</span>
                        <span className="block truncate text-xs text-neutral-400">{projectClient(p) || t('proj.noClient')}</span>
                        <span data-testid={`acc-timeline-${p.id}`} className="mt-0.5 block truncate text-xs text-neutral-500">
                          {[datesOf(p), pulseOf(p)].filter(Boolean).join(' · ')}
                        </span>
                        {late > 0 && (
                          <span
                            data-testid={`acc-late-${p.id}`}
                            className="mt-1 inline-block max-w-full truncate rounded-full border border-orange-400/50 px-1.5 text-xs font-semibold text-orange-400"
                          >
                            {t('acc.card.late', { n: late })}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className={`block font-medium tabular-nums ${b.balance < 0 ? 'text-red-400' : 'text-brand'}`}>{fmt(b.balance)}</span>
                        <span className="block text-xs text-neutral-400">{t('xl.balance')}</span>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

    </main>
  );
}
