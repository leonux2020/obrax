import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { cashSummary, expenseDayLabel, expensesTotal, supplierTotals } from '../lib/ledger.js';
import { projectClient, projectTitle } from '../lib/projects.js';
import { UI_WATCHDOG_MS, settleWithin } from '../lib/exportSync.js';
import { useExportQueue } from '../lib/useExportSync.js';
import { CloudUploadIcon } from './workspace/icons.jsx';

/** Font size by length of the amount, so a figure always fits its third of the header on a 320 px screen. */
const sizeFor = (text) => (text.length <= 9 ? 'text-lg' : text.length <= 11 ? 'text-base' : text.length <= 13 ? 'text-sm' : 'text-xs');

function Stat({ id, label, value, tone = '' }) {
  return (
    <div data-testid={id} className="min-w-0 px-2 py-3 text-center">
      <p className="truncate text-[11px] font-semibold uppercase tracking-tight text-white/50">{label}</p>
      <p className={`mt-1 whitespace-nowrap font-medium tracking-tight tabular-nums ${sizeFor(value)} ${tone || 'text-[#E0E0E0]'}`} data-testid={`${id}-value`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Financial command center of ONE project (full screen, opened from the Contabilidad card):
 *  - OLED headers: Fondo asignado (income) · Total gastado · Saldo a rendir (fund - spent),
 *  - Ingresos / Egresos: READ-ONLY lists. They show what was typed in the project itself (the client's payments of the CashBlock and the
 *    expenses module): the single source of truth. Nothing is entered here,
 *  - "Cerrar Rendición (Enviar a Drive)": the Excel goes to Drive, or to the offline queue (it is never downloaded).
 *
 * No back arrow: the phone's own Back (history) leaves it. `onCloseRendition()` resolves when it is done.
 */
export default function ProjectFinancialDashboard({ project, onCloseRendition, onRetryQueue = null, onReconnect = null, needsReconnect = false, queue, watchdogMs = UI_WATCHDOG_MS }) {
  const { t, money, moneyIn, locale } = useI18n();
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false); // the user asked for the Google window: the button says so until Google answers
  const rows = useExportQueue(queue).filter((r) => r.projectId === project.id);
  const waiting = rows.filter((r) => r.status !== 'failed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  const fund = cashSummary(0, project.payments).paid;
  const spent = expensesTotal(project.expenses);
  const toRender = Math.round((fund - spent) * 100) / 100;
  const entries = useMemo(() => [...project.payments].sort((a, b) => b.at - a.at), [project.payments]);
  const title = projectTitle(project) || t('proj.untitled');
  // USCITE grouped by shop: the name ONCE as a heading, then its tickets (date + amount) newest first
  const groups = useMemo(() => {
    // the day printed on the receipt when there is one, else the moment it was registered
    const when = (e) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date || '');
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime() : e.at;
    };
    return supplierTotals(project.expenses).map((g) => ({
      ...g,
      items: project.expenses
        .filter((e) => {
          const name = (e.supplier || '').trim().replace(/\s+/g, ' ').toLowerCase();
          return name === g.name.toLowerCase() && (String(e.currency || '').toUpperCase() === g.currency);
        })
        .sort((a, b) => when(b) - when(a) || b.at - a.at),
    }));
  }, [project.expenses]);

  // "Reconectar Drive": the ONLY place besides "Enviar a Drive" where the Google window may open, and only by this tap
  const reconnect = async () => {
    if (connecting || !onReconnect) return;
    setConnecting(true);
    try {
      await settleWithin(onReconnect(), watchdogMs);
    } catch {
      /* the parent already told the user */
    } finally {
      setConnecting(false);
    }
  };

  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // the parent reads the connection synchronously (offline = parked in IndexedDB at once) and shows the toast; whatever happens the button is freed
      await settleWithin(onCloseRendition(), watchdogMs);
    } catch {
      /* the parent already told the user; nothing may leave the screen frozen */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black text-[#E0E0E0]" data-testid="project-finance" role="dialog" aria-modal="true" aria-label={`${t('fin.title')}: ${title}`}>
      <main className="mx-auto w-full max-w-3xl px-3 pb-40 pt-3 sm:px-4">
        <header className="mb-3">
          <h1 className="truncate text-xl font-semibold tracking-tight" data-testid="fin-title">
            {title}
          </h1>
          <span className="block truncate text-xs text-neutral-400">{projectClient(project) || t('proj.noClient')}</span>
        </header>

        <section className="grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-black tabular-nums" aria-label={t('fin.title')} data-testid="fin-summary">
          <Stat id="fin-fund" label={t('fin.fund')} value={money(fund)} />
          <Stat id="fin-spent" label={t('fin.spent')} value={money(spent)} />
          <Stat id="fin-balance" label={t('fin.toRender')} value={money(toRender)} tone={toRender < 0 ? 'text-red-400' : 'text-brand'} />
        </section>

        {/* Ingresos: read-only mirror of the CashBlock */}
        <section className="mt-5" data-testid="fin-income">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('fin.income')}</h2>
          {entries.length === 0 ? (
            <p className="text-sm text-neutral-400" data-testid="fin-income-empty">
              {t('fin.income.empty')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="fin-income-list">
              {entries.map((x) => (
                <li key={x.id} data-testid={`fin-income-${x.id}`} className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{x.note || (x.method && t(`ws.cash.m.${x.method}`)) || t('fin.income')}</span>
                    <span className="block truncate text-xs text-neutral-400">
                      {[day.format(new Date(x.at)), x.note && x.method ? t(`ws.cash.m.${x.method}`) : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-sm font-medium tabular-nums text-brand">{money(x.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Egresos: read-only mirror of the expenses module */}
        <section className="mt-5" data-testid="fin-expenses">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-400">{t('fin.expenses')}</h2>
          {project.expenses.length === 0 ? (
            <p className="text-sm text-neutral-400" data-testid="fin-expenses-empty">
              {t('fin.expenses.empty')}
            </p>
          ) : (
            <>
              <div className="mb-2 space-y-3" data-testid="fin-expenses-list">
                {groups.map((g, i) => {
                  const fmt = (v) => (g.currency ? moneyIn(v, g.currency) : money(v));
                  return (
                    <section key={g.key} data-testid={`fin-shop-${i}`} className="rounded-xl border border-white/10">
                      <h3 className="flex items-baseline justify-between gap-3 px-3 pt-2.5">
                        <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${g.name ? 'text-neutral-100' : 'text-neutral-400'}`} data-testid="fin-shop-name">
                          {g.name || t('exp.noSupplier')}
                        </span>
                        <span className="shrink-0 text-sm font-medium tabular-nums text-neutral-100" data-testid="fin-shop-total">
                          {fmt(g.total)}
                        </span>
                      </h3>
                      <ul className="divide-y divide-white/5 px-3 pb-1 pt-1">
                        {g.items.map((e) => (
                          <li key={e.id} data-testid={`fin-expense-${e.id}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                              <span className="shrink-0 whitespace-nowrap text-neutral-400 tabular-nums" data-testid="fin-expense-date">
                                {expenseDayLabel(e.date, locale) || day.format(new Date(e.at))}
                              </span>
                              {/* "Receipt stack": the receipt's own line (the branch / street address the scan read, else the product description) as grey micro-text; nothing when there is none */}
                              {(e.sucursal || e.description) && (
                                <>
                                  <span aria-hidden="true" className="shrink-0 text-xs text-neutral-600">
                                    •
                                  </span>
                                  <span className="min-w-0 max-w-[150px] truncate text-xs text-neutral-500" title={e.sucursal || e.description} data-testid="fin-expense-note" data-source={e.sucursal ? 'sucursal' : 'description'}>
                                    {e.sucursal || e.description}
                                  </span>
                                </>
                              )}
                            </span>
                            <span className="shrink-0 tabular-nums text-[#E0E0E0]">{fmt(e.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
              <p className="flex items-baseline justify-between rounded-2xl border border-white/10 px-4 py-3" data-testid="fin-expenses-total">
                <span className="text-sm font-semibold">{t('fin.expenses.total')}</span>
                <span className="font-medium tabular-nums">{money(spent)}</span>
              </p>
            </>
          )}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50 bg-gradient-to-t from-black via-black to-transparent px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6">
        <div className="mx-auto max-w-3xl space-y-2">
          {(waiting > 0 || failed > 0) && (
            <p role="status" data-testid="fin-queued" className="flex items-center justify-between gap-2 rounded-lg px-1 text-sm font-semibold text-[#e8c35f]">
              <span>{[waiting > 0 && t('fin.queued', { n: waiting }), failed > 0 && t('fin.queued.failed', { n: failed })].filter(Boolean).join(' · ')}</span>
              {needsReconnect && onReconnect ? (
                <button type="button" onClick={reconnect} disabled={connecting} data-testid="fin-reconnect" className="min-h-[44px] shrink-0 rounded-lg border border-[#d4af37] px-3 text-[#e8c35f] disabled:opacity-50">
                  {connecting ? t('fin.reconnecting') : t('fin.reconnect')}
                </button>
              ) : (
                onRetryQueue && (
                  <button type="button" onClick={onRetryQueue} data-testid="fin-queued-retry" className="min-h-[44px] shrink-0 rounded-lg border border-[#d4af37] px-3 text-[#e8c35f]">
                    {t('fin.queued.retry')}
                  </button>
                )
              )}
            </p>
          )}
          <button
            type="button"
            onClick={close}
            disabled={busy}
            data-testid="fin-close"
            className="flex min-h-[64px] w-full select-none items-center justify-center gap-2 rounded-2xl border-2 border-brand bg-black px-5 text-lg font-medium text-brand transition active:scale-[0.98] disabled:opacity-40"
          >
            <CloudUploadIcon size={24} />
            {busy ? t('fin.closing') : t('fin.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
