import { useI18n } from '../../lib/i18n.jsx';
import BackupBadge from '../BackupBadge.jsx';
import WeatherChip from './WeatherChip.jsx';
import { LockIcon } from './icons.jsx';

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

/** A width in %: never NaN, never outside the lane. */
const clamp = (n) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

/**
 * ZONE A: the header that never scrolls away. Flag + name, client, place, the lock and ONE number: what is still to be collected (DA INCASSARE,
 * soft orange while there is debt, never red). The quote and what is already collected go under it, small and grey; when nothing is left
 * it says "Saldato" with a green check instead. At the base of the block runs the DUAL LIQUIDITY TRACK: two 2 px lanes 1 px apart, the money collected
 * of the budget (green) over the real physical progress of the Cronograma (ice-blue), both plain continuous lines over a barely-there ghost track, plus a two-item legend.
 * DRAFT (`sandbox` = { name, onName, stale }): the job is not in the database yet. The name is an invisible input ("Toca para añadir nombre"), and the big figure is
 * tagged "(Simulación)" in amber: it is not definitive. 
 * No deadline / countdown of any kind (no "on time", no days left, no late alert: the debt already says it), no back arrow (the device's back gesture leaves the project), no globe, no coordinates.
 */
export default function HeaderZone({ project, model, title, client, region, offline, onEdit, onCash, onUnlock, audit = false, sandbox = null }) {
  const { t, money } = useI18n();
  // the place is shown only when it has a NAME; raw coordinates are data, not interface
  const where = project.location?.label || '';
  const cash = model.bars[1];
  const physical = model.physical ?? { pct: 0 }; // the real progress of the Cronograma; 0 while there is no data
  const physicalPct = Math.round(clamp(physical.pct));
  const known = model.total !== null; // a valid quote: the budget and what is left can be told
  const settled = !sandbox && known && model.total > 0 && cash.pending <= 0.005;
  return (
    <header data-testid="ws-zone-a" data-region={region.code} className="sticky top-0 z-20 border-b border-white/10 bg-black px-3 pb-3 pt-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {/* the flag is the WORK SITE's country: it leads the project name, not the client's line */}
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" data-testid="ws-flag" className="shrink-0 text-xl leading-tight">
              {region.flag}
            </span>
            {sandbox ? (
              <h1 className="min-w-0 flex-1 text-xl font-semibold leading-tight">
                <input
                  type="text"
                  value={sandbox.name}
                  onChange={(e) => sandbox.onName(e.target.value)}
                  placeholder={t('ws.draft.namePh')}
                  maxLength={60}
                  autoComplete="off"
                  aria-label={t('project.name')}
                  data-testid="ws-draft-name"
                  className="min-h-[44px] w-full truncate bg-transparent text-xl font-semibold leading-tight text-neutral-100 placeholder:font-light placeholder:text-neutral-400"
                />
              </h1>
            ) : (
              <h1 data-testid="ws-title" className="min-w-0 truncate text-xl font-semibold leading-tight">
                {title}
              </h1>
            )}
          </div>
          <p className="truncate text-sm text-neutral-300" data-testid="ws-client">
            {client || t('proj.noClient')}
            {where && (
              <>
                <span className="text-neutral-500"> · </span>
                <span data-testid="ws-location">{where}</span>
              </>
            )}
          </p>
        </div>
        <WeatherChip project={project} regionCode={region.code} />
        <BackupBadge />
        {!audit && (
          <button type="button" onClick={onEdit} aria-label={t('proj.edit')} data-testid="ws-edit" className="flex h-11 w-11 shrink-0 items-center justify-center text-neutral-400 transition hover:text-white active:text-white">
            <Pencil />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        {/* audit (ledger) mode: the figures are plain text, not a button that opens the payments */}
        <Total audit={audit} onCash={onCash} label={t('cash.title')} settled={settled}>
          {settled ? (
            <span data-testid="ws-settled" className="flex items-center justify-end gap-2 text-3xl font-medium leading-none tracking-tight text-brand">
              <Check />
              {t('ws.settled')}
            </span>
          ) : (
            <>
              <span data-testid="ws-due-label" className="block text-xs font-medium uppercase text-neutral-400">
                {t('ws.due')}
                {sandbox && (
                  <span data-testid="ws-sim-label" className="ml-1.5 normal-case text-[#e8c35f]/90">
                    {t('ws.sim.label')}
                  </span>
                )}
              </span>
              <span data-testid="ws-due" className={`mt-1 block text-3xl font-medium leading-none tracking-tight tabular-nums ${sandbox ? 'text-[#e8c35f]/90' : known && cash.pending > 0 ? 'text-orange-400' : 'text-neutral-400'}`}>
                {known ? money(cash.pending) : '—'}
              </span>
            </>
          )}
          {sandbox?.stale && (
            <span data-testid="ws-sim-stale" className="mt-1.5 block text-xs font-light text-neutral-400">
              {t('ws.sim.stale')}
            </span>
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
          {model.locked && audit && (
            <span data-testid="ws-lock-chip" className="mt-1 block text-xs font-medium text-neutral-400">
              🔒 {t(model.locked === 'signed' ? 'ws.lock.signed' : 'ws.lock.frozen')}
            </span>
          )}
        </Total>
      </div>

      {/* ONE element says the state AND gives the action: the lock, "Sblocca preventivo", and (quiet, underneath) why it is locked. No loose yellow text. */}
      {model.locked && !audit && (
        <button
          type="button"
          onClick={onUnlock}
          data-testid="ws-unlock"
          data-lock={model.locked}
          aria-label={`${t('ws.unlock')} - ${t(model.locked === 'signed' ? 'ws.lock.signed' : 'ws.lock.frozen')}`}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-lg border border-[#d4af37]/40 bg-transparent px-3 py-1.5 text-[#e8c35f] transition active:border-[#d4af37]"
        >
          <LockIcon size={18} />
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm font-medium leading-tight">{t('ws.unlock')}</span>
            <span data-testid="ws-lock-why" className="block truncate text-xs font-normal leading-tight text-neutral-400">
              {t(model.locked === 'signed' ? 'ws.lock.signed' : 'ws.lock.frozen')}
            </span>
          </span>
        </button>
      )}
      {offline && (
        <p data-testid="ws-offline" className="mt-2 border-l-2 border-white/30 pl-2 text-xs text-neutral-400">
          {t('ws.offlineBase')}
        </p>
      )}
      {/* Dual liquidity track: the money (upper lane, green) and the real work (lower lane, ice-blue) of the job, under the figures. A legend names both. */}
      <ul data-testid="ws-legend" className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-light tabular-nums text-neutral-400">
        {cash.pct !== null && cash.pct !== undefined && (
          <li data-testid="ws-legend-cash" className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand/90" />
            {t('ws.collected')} <span>{Math.round(cash.pct)}%</span>
          </li>
        )}
        <li data-testid="ws-legend-physical" className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
          {t('ws.lane.physical')} <span>{physicalPct}%</span>
        </li>
      </ul>
      <div data-testid="ws-lanes" className="absolute inset-x-0 bottom-0 flex flex-col gap-px">
        {cash.pct !== null && cash.pct !== undefined && (
          <div data-testid="ws-progress" data-pct={Math.round(cash.pct)} className="relative h-0.5 w-full bg-white/5" role="progressbar" aria-label={t('ws.collected')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cash.pct)}>
            <div data-testid="ws-progress-fill" className="lane-grow h-full bg-brand transition-all duration-500" style={{ width: `${clamp(cash.pct)}%` }} />
          </div>
        )}
        <div data-testid="ws-physical" data-pct={physicalPct} className="relative h-0.5 w-full bg-white/5" role="progressbar" aria-label={t('ws.lane.physical')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={physicalPct}>
          <div data-testid="ws-physical-fill" className="lane-grow h-full bg-cyan-500 transition-all duration-500" style={{ width: `${clamp(physical.pct)}%` }} />
        </div>
      </div>
    </header>
  );
}
