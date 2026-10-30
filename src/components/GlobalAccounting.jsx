import { useMemo, useState } from 'react';
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { useMarketClock } from '../lib/marketClock.js';
import { getRegion } from '../lib/regions.js';
import { buildRenditionFile, projectBalance } from '../lib/rendition.js';
import {
  collectionDelay,
  daysAgo,
  getLastProjectActivity,
  globalBreakdown,
  globalTaxLabel,
  projectDateRange,
  projectLiquidity,
  receivableList,
  sortByActivity,
} from '../lib/ledger.js';
import GlobalBreakdownSheet from './GlobalBreakdownSheet.jsx';
import { projectClient, projectTitle } from '../lib/projects.js';
import { projectTotals } from '../lib/projectTotals.js';
import { usePriceVersion } from '../lib/usePrices.js';
import { shareOrDownload } from '../lib/shareFile.js';
import { Button, Logo } from './ui.jsx';

/**
 * "Contabilidad Global": every project with its cash balance (collected - expenses - advances). Tick several and
 * one tap shares a single consolidated Excel through the native share sheet (a download where it cannot).
 *
 * Above the list a minimal HUD (net cash, tax shield, receivables) over the ACTIVE projects, one line per currency; each card
 * shows its dates and last-activity pulse, the list is ordered by last movement, and an overdrawn project gets an amber edge.
 * Everything is deduced from the records already stored (nothing new is saved).
 */
const AMBER = 'text-[#e8c35f]';

/** Font size by length of the amount, so a figure always fits its third of the HUD on a 320 px screen (never wraps or clips). */
const sizeFor = (text) =>
  text.length <= 9 ? 'text-sm' : text.length <= 11 ? 'text-[13px]' : text.length <= 13 ? 'text-xs' : text.length <= 15 ? 'text-[11px]' : 'text-[10px]';

/** One floating HUD column: compact label + one amount per currency (never mixed). No box, no divider. */
function HudColumn({ id, label, lines, fmtOf, warn = false, flag = null }) {
  return (
    <span data-testid={id} className="block min-w-0">
      <span className="block whitespace-nowrap text-[11px] font-semibold uppercase tracking-tight text-white/50 sm:text-xs">
        {label}
        {flag}
      </span>
      {lines.length === 0 ? (
        <span className="mt-1 block text-sm font-extrabold tabular-nums text-[#E0E0E0]/50">—</span>
      ) : (
        lines.map((l) => {
          const text = fmtOf(l.regionCode)(l.amount);
          return (
            <span
              key={l.currency}
              data-testid={`${id}-${l.currency}`}
              className={`mt-1 block whitespace-nowrap font-extrabold tabular-nums ${sizeFor(text)} ${warn && l.amount < 0 ? AMBER : 'text-[#E0E0E0]'}`}
            >
              {text}
            </span>
          );
        })
      )}
    </span>
  );
}

export default function GlobalAccounting({ projects, onOpenProject = null }) {
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
  const receivables = useMemo(() => receivableList(projects, totals, now), [projects, totals, now]);
  const taxLabel = useMemo(() => globalTaxLabel(projects), [projects]);
  const lines = (key) => breakdown.map((l) => ({ currency: l.currency, regionCode: l.regionCode, amount: l[key] }));
  const lateCount = receivables.filter((x) => x.late > 0).length;
  const [open, setOpen] = useState(false);
  const titleOf = (id) => {
    const p = projects.find((x) => x.id === id);
    return (p && projectTitle(p)) || t('proj.untitled');
  };
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

  const exportGlobal = async () => {
    const chosen = projects.filter((p) => selected.includes(p.id));
    if (!chosen.length || busy) return;
    setBusy(true);
    setNote('');
    try {
      const regions = new Set(chosen.map((p) => getRegion(p.draft.regionCode)?.currency));
      const first = getRegion(chosen[0].draft.regionCode);
      const file = buildRenditionFile(chosen, totals, {
        t,
        locale,
        currency: regions.size === 1 ? first.currency : '',
        digits: first.digits,
      });
      const outcome = await shareOrDownload(file, {
        title: t('xl.shareTitleGlobal'),
      });
      setNote(outcome === 'downloaded' ? 'downloaded' : '');
    } catch {
      setNote('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-44 pt-3 sm:px-4" data-testid="accounting">
      <header className="mb-3 flex items-center gap-3">
        <Logo size={32} />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{t('nav.accounting')}</h1>
        {projects.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(all ? [] : projects.map((p) => p.id))}
            data-testid="acc-all"
            className="min-h-[44px] rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand"
          >
            {t(all ? 'acc.none' : 'acc.all')}
          </button>
        )}
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
            className="mb-3 grid w-full cursor-pointer grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black px-2 py-3 text-center transition-opacity active:opacity-80"
          >
            <HudColumn id="acc-liquid" label={t('acc.hud.liquid')} lines={lines('liquid')} fmtOf={moneyOf} warn />
            <HudColumn id="acc-tax" label={taxLabel || t('acc.hud.tax')} lines={lines('tax')} fmtOf={moneyOf} />
            <HudColumn
              id="acc-receivable"
              label={t('acc.hud.receivable')}
              lines={lines('receivable')}
              fmtOf={moneyOf}
              flag={
                lateCount > 0 && (
                  <span
                    data-testid="acc-late-badge"
                    role="img"
                    aria-label={t('acc.hud.late', { n: lateCount })}
                    className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-orange-400 align-middle"
                  />
                )
              }
            />
          </button>
          {open && (
            <GlobalBreakdownSheet
              breakdown={breakdown}
              receivables={receivables}
              taxLabel={taxLabel}
              titleOf={titleOf}
              moneyOf={moneyOf}
              onClose={() => setOpen(false)}
            />
          )}
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
                      onClick={() => onOpenProject?.(p.id)}
                      aria-label={t('fin.open', { name: projectTitle(p) || t('proj.untitled') })}
                      data-testid={`acc-open-${p.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-r-2xl py-3 pr-4 text-left active:opacity-80"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{projectTitle(p) || t('proj.untitled')}</span>
                        <span className="block truncate text-xs text-neutral-400">{projectClient(p) || t('proj.noClient')}</span>
                        <span data-testid={`acc-timeline-${p.id}`} className="mt-0.5 block truncate text-xs text-[#E0E0E0]/50">
                          {[datesOf(p), pulseOf(p)].filter(Boolean).join(' · ')}
                        </span>
                        {late > 0 && (
                          <span
                            data-testid={`acc-late-${p.id}`}
                            className="mt-1 inline-block max-w-full truncate rounded-full border border-orange-400/50 px-1.5 text-[10px] font-semibold text-orange-400"
                          >
                            {t('acc.card.late', { n: late })}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`block font-extrabold tabular-nums ${b.balance < 0 ? 'text-red-400' : 'text-brand'}`}>{fmt(b.balance)}</span>
                        <span className="block text-[11px] text-neutral-400">{t('xl.balance')}</span>
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {projects.length > 0 && (
        <div className="no-print fixed inset-x-0 z-30 px-3 [bottom:calc(5.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-3xl">
            {note === 'error' && (
              <p role="alert" className="mb-2 rounded-lg bg-black px-1 text-sm font-semibold text-red-400">
                {t('xl.error')}
              </p>
            )}
            {note === 'downloaded' && (
              <p role="status" data-testid="acc-note" className="mb-2 rounded-lg bg-black px-1 text-sm font-semibold text-brand">
                {t('share.downloaded')}
              </p>
            )}
            <Button className="w-full" disabled={selected.length === 0 || busy} onClick={exportGlobal} data-testid="acc-export">
              {busy ? t('pdf.generating') : t('acc.export', { n: selected.length })}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
