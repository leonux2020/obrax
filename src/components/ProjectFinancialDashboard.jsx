import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { cashSummary, expensesTotal, newFundEntry } from '../lib/ledger.js';
import { projectClient, projectTitle, toDayString } from '../lib/projects.js';
import { sanitizeText } from '../lib/sanitize.js';
import { UI_WATCHDOG_MS, settleWithin } from '../lib/exportSync.js';
import { useExportQueue } from '../lib/useExportSync.js';
import { Button, DateInput, NumberField, TextField } from './ui.jsx';
import { SupplierTotals } from './ExpenseParts.jsx';

/** Font size by length of the amount, so a figure always fits its third of the header on a 320 px screen. */
const sizeFor = (text) => (text.length <= 9 ? 'text-lg' : text.length <= 11 ? 'text-base' : text.length <= 13 ? 'text-sm' : 'text-xs');

function Stat({ id, label, value, tone = '' }) {
  return (
    <div data-testid={id} className="min-w-0 rounded-2xl border border-white/10 bg-black px-2 py-3 text-center">
      <p className="truncate text-[11px] font-semibold uppercase tracking-tight text-white/50">{label}</p>
      <p className={`mt-1 whitespace-nowrap font-extrabold tabular-nums ${sizeFor(value)} ${tone || 'text-[#E0E0E0]'}`} data-testid={`${id}-value`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Financial command center of ONE project (full screen, opened from the Contabilidad card):
 *  - OLED headers: Fondo asignado (income) · Total gastado · Saldo a rendir (fund - spent),
 *  - Ingresos: a quick manager of "Adelantos / Caja chica" (date, amount, description) saved with the project in IndexedDB,
 *  - Egresos: the per-supplier totals strip and the grand total,
 *  - "Cerrar Rendición (Enviar a Drive)": the Excel goes to Drive, or to the offline queue (it is never downloaded).
 *
 * `onChange(patch)` saves a change of the project ({ payments }); `onClose()` goes back; `onCloseRendition()` resolves when it is done.
 */
export default function ProjectFinancialDashboard({ project, onChange, onBack, onCloseRendition, onRetryQueue = null, onReconnect = null, needsReconnect = false, queue, watchdogMs = UI_WATCHDOG_MS }) {
  const { t, money, locale } = useI18n();
  const [date, setDate] = useState(() => toDayString(new Date()));
  const [amount, setAmount] = useState(null);
  const [note, setNote] = useState('');
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

  const add = (e) => {
    e.preventDefault();
    const entry = newFundEntry({ amount, date, note });
    if (!entry) return;
    onChange({ payments: [entry, ...project.payments] });
    setAmount(null);
    setNote('');
  };

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
        <header className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('fin.back')}
            data-testid="fin-back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 text-xl hover:border-brand"
          >
            ←
          </button>
          <span className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-tight" data-testid="fin-title">
              {title}
            </h1>
            <span className="block truncate text-xs text-neutral-400">{projectClient(project) || t('proj.noClient')}</span>
          </span>
        </header>

        <section className="grid grid-cols-3 gap-2" aria-label={t('fin.title')}>
          <Stat id="fin-fund" label={t('fin.fund')} value={money(fund)} />
          <Stat id="fin-spent" label={t('fin.spent')} value={money(spent)} />
          <Stat id="fin-balance" label={t('fin.toRender')} value={money(toRender)} tone={toRender < 0 ? 'text-red-400' : 'text-brand'} />
        </section>

        {/* Ingresos */}
        <section className="mt-5" data-testid="fin-income">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">{t('fin.income')}</h2>
          <form onSubmit={add} className="space-y-3 rounded-2xl border border-white/10 p-3" data-testid="fin-income-form">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="fin-date">
                  {t('fin.income.date')}
                </label>
                <DateInput id="fin-date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="fin-income-date" />
              </div>
              <NumberField label={t('fin.income.amount')} value={amount} onChange={setAmount} decimals={2} placeholder="0" />
            </div>
            <TextField label={t('fin.income.desc')} placeholder={t('fin.income.descPh')} value={note} sanitize={(v) => sanitizeText(v, 80)} onChange={setNote} testId="fin-income-note" />
            <Button type="submit" className="w-full" disabled={!(amount > 0)} data-testid="fin-income-add">
              {t('fin.income.add')}
            </Button>
          </form>

          {entries.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400" data-testid="fin-income-empty">
              {t('fin.income.empty')}
            </p>
          ) : (
            <ul className="mt-2 space-y-2" data-testid="fin-income-list">
              {entries.map((x) => (
                <li key={x.id} data-testid={`fin-income-${x.id}`} className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{x.note || t('fin.income')}</span>
                    <span className="block text-xs text-neutral-400">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(x.at))}</span>
                  </span>
                  <span className="text-sm font-extrabold tabular-nums text-brand">{money(x.amount)}</span>
                  <button
                    type="button"
                    onClick={() => onChange({ payments: project.payments.filter((p) => p.id !== x.id) })}
                    aria-label={`${t('fin.income.delete')}: ${x.note || money(x.amount)}`}
                    className="-mr-1 flex h-10 w-10 items-center justify-center text-lg text-neutral-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Egresos */}
        <section className="mt-5" data-testid="fin-expenses">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">{t('fin.expenses')}</h2>
          {project.expenses.length === 0 ? (
            <p className="text-sm text-neutral-400" data-testid="fin-expenses-empty">
              {t('fin.expenses.empty')}
            </p>
          ) : (
            <>
              <SupplierTotals expenses={project.expenses} />
              <p className="flex items-baseline justify-between rounded-2xl border border-white/10 px-4 py-3" data-testid="fin-expenses-total">
                <span className="text-sm font-bold">{t('fin.expenses.total')}</span>
                <span className="font-extrabold tabular-nums">{money(spent)}</span>
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
            className="flex min-h-[64px] w-full select-none items-center justify-center gap-2 rounded-2xl border-2 border-brand bg-black px-5 text-lg font-extrabold text-brand transition active:scale-[0.98] disabled:opacity-40"
          >
            <span aria-hidden="true">☁️</span>
            {busy ? t('fin.closing') : t('fin.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
