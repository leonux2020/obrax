import { useI18n } from '../../lib/i18n.jsx';
import { levelDetail } from '../levelStyle.js';

const Check = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="ws-settled-check">
    <circle cx="12" cy="12" r="9.5" />
    <path d="m7.8 12.4 2.9 2.9 5.5-6" />
  </svg>
);

const Pencil = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

/** The big figures of the header: a button that opens the payments (tactical mode) or plain text (audit mode). */
function Total({ audit, onCash, label, settled, children }) {
  if (audit) {
    return (
      <div data-testid="ws-total" data-settled={settled || undefined} className="ml-auto text-right">
        {children}
      </div>
    );
  }
  return (
    <button type="button" onClick={onCash} aria-label={label} data-testid="ws-total" data-settled={settled || undefined} className="ml-auto text-right">
      {children}
    </button>
  );
}

/**
 * ZONE A: the header that never scrolls away. Name, client, place, the lock and ONE number: what is still to be collected (DA INCASSARE,
 * soft orange while there is debt, never red). The quote and what is already collected go under it, small and grey; when nothing is left
 * it says "Saldato" with a green check instead. ONE 2 px line at the base of the block shows the share collected of the budget.
 * No red late alert (the debt already says it), no back arrow (the device's back gesture leaves the project), no globe, no coordinates.
 */
export default function HeaderZone({ project, model, title, client, region, offline, onEdit, onCash, onUnlock, audit = false }) {
  const { t, money } = useI18n();
  // the place is shown only when it has a NAME; raw coordinates are data, not interface
  const where = project.location?.label || '';
  const detail = model.closed ? t('proj.closed') : levelDetail(t, model.info) || t(`light.${model.info.level}`);
  const cash = model.bars[1];
  const known = model.total !== null; // a valid quote: the budget and what is left can be told
  const settled = known && model.total > 0 && cash.pending <= 0.005;
  const late = model.info.level === 'red'; // late jobs show no red text: the debt number already says it
  return (
    <header data-testid="ws-zone-a" data-region={region.code} className="sticky top-0 z-20 border-b border-white/10 bg-black px-3 pb-3 pt-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 data-testid="ws-title" className="truncate text-xl font-semibold leading-tight">
            {title}
          </h1>
          <p className="truncate text-sm text-[#E0E0E0]/80">
            <span aria-hidden="true">{region.flag}</span> {client || t('proj.noClient')}
            {where && (
              <>
                <span className="text-[#E0E0E0]/50"> · </span>
                <span data-testid="ws-location">{where}</span>
              </>
            )}
          </p>
        </div>
        {!audit && (
          <button type="button" onClick={onEdit} aria-label={t('proj.edit')} data-testid="ws-edit" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 active:border-white/40">
            <Pencil />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        {!late && (
          <p
            data-testid="ws-status"
            data-level={model.level}
            aria-label={`${t('ws.state')}: ${detail}`}
            style={{ borderLeftColor: model.tone, color: model.tone }}
            className="border-l-2 pl-2 text-sm font-semibold leading-tight"
          >
            {t(`light.${model.info.level}`)}
            <span className="block text-base">{detail}</span>
          </p>
        )}
        {/* audit (ledger) mode: the figures are plain text, not a button that opens the payments */}
        <Total audit={audit} onCash={onCash} label={t('cash.title')} settled={settled}>
          {settled ? (
            <span data-testid="ws-settled" className="flex items-center justify-end gap-2 text-3xl font-medium leading-none tracking-tight text-brand">
              <Check />
              {t('ws.settled')}
            </span>
          ) : (
            <>
              <span data-testid="ws-due-label" className="block text-xs font-medium uppercase tracking-wider text-neutral-400">
                {t('ws.due')}
              </span>
              <span data-testid="ws-due" className={`mt-1 block text-3xl font-medium leading-none tracking-tight tabular-nums ${known && cash.pending > 0 ? 'text-orange-400' : 'text-neutral-400'}`}>
                {known ? money(cash.pending) : '—'}
              </span>
            </>
          )}
          {(known || cash.paid > 0) && (
            <span data-testid="ws-summary" className="mt-1.5 block text-xs tabular-nums text-neutral-400">
              {known && (
                <>
                  {t('ws.quote')} <span data-testid="ws-quote">{money(model.total)}</span>
                </>
              )}
              {known && cash.paid > 0 && <span aria-hidden="true"> · </span>}
              {cash.paid > 0 && (
                <>
                  {t('ws.collected')} <span data-testid="ws-collected">{money(cash.paid)}</span>
                </>
              )}
            </span>
          )}
          {model.locked && (
            <span data-testid="ws-lock-chip" className="mt-1 block text-[11px] font-medium text-[#e8c35f]">
              🔒 {t(model.locked === 'signed' ? 'ws.lock.signed' : 'ws.lock.frozen')}
            </span>
          )}
        </Total>
      </div>

      {model.locked && !audit && (
        <button type="button" onClick={onUnlock} data-testid="ws-unlock" className="mt-2 min-h-[40px] w-full rounded-lg border border-[#d4af37]/60 px-3 text-xs font-semibold text-[#e8c35f] active:border-[#d4af37]">
          {t('ws.unlock')}
        </button>
      )}
      {offline && (
        <p data-testid="ws-offline" className="mt-2 border-l-2 border-white/30 pl-2 text-[11px] text-[#E0E0E0]/70">
          {t('ws.offlineBase')}
        </p>
      )}
      {/* ONE ultra-thin line at the base of the block: the share collected of the budget */}
      {cash.pct !== null && cash.pct !== undefined && (
        <div data-testid="ws-progress" data-pct={Math.round(cash.pct)} className="absolute inset-x-0 bottom-0 h-0.5 bg-neutral-800" role="progressbar" aria-label={t('ws.collected')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cash.pct)}>
          <div data-testid="ws-progress-fill" className="h-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, cash.pct))}%` }} />
        </div>
      )}
    </header>
  );
}
