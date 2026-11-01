import { useI18n } from '../../lib/i18n.jsx';
import { levelDetail } from '../levelStyle.js';

const Pencil = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

/**
 * One meter, stacked so nothing is crammed: label on top, value below it on the right, the thin bar on its own line.
 * The only colour is the bar's fill (a progress indicator, not a state background); the texts are quiet neutral grey so they never
 * compete with the total.
 */
function Bar({ id, label, pct, tone, text, sub = null, className = '' }) {
  const drawn = pct !== null && pct !== undefined;
  if (!drawn && !sub) return null;
  return (
    <div data-testid={`bar-${id}`} data-pct={drawn ? Math.round(pct) : undefined} className={`min-w-0 ${className}`}>
      <p className="text-sm text-neutral-400">{label}</p>
      <p data-testid={`bar-${id}-value`} className="mt-0.5 text-right text-sm tabular-nums text-neutral-400">
        {drawn && text}
        {sub}
      </p>
      {drawn && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full border border-white/15" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: tone }} />
        </div>
      )}
    </div>
  );
}

/**
 * ZONE A: the header that never scrolls away. Name, client, place, state with its days, the live total, the lock and the progress
 * bars. Colour = only a 2 px left border and the lettering of the state line. Quiet by design: no back arrow (the device's back
 * gesture / button leaves the project), no globe, no coordinates (they stay in the project data, never drawn), a late project
 * says only "Ritardo di X g", and the three loudest texts (name, late alert, total) are one weight lighter.
 */
export default function HeaderZone({ project, model, title, client, region, offline, onEdit, onCash, onUnlock }) {
  const { t, money } = useI18n();
  // the place is shown only when it has a NAME; raw coordinates are data, not interface
  const where = project.location?.label || '';
  const detail = model.closed ? t('proj.closed') : levelDetail(t, model.info) || t(`light.${model.info.level}`);
  const [time, cash] = model.bars;
  return (
    <header data-testid="ws-zone-a" data-region={region.code} className="sticky top-0 z-20 border-b border-white/10 bg-black px-3 pb-2 pt-2">
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
        <button type="button" onClick={onEdit} aria-label={t('proj.edit')} data-testid="ws-edit" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 active:border-white/40">
          <Pencil />
        </button>
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <p
          data-testid="ws-status"
          data-level={model.level}
          aria-label={`${t('ws.state')}: ${detail}`}
          style={{ borderLeftColor: model.tone, color: model.tone }}
          className={`border-l-2 pl-2 text-sm leading-tight ${model.info.level === 'red' ? 'font-medium' : 'font-extrabold'}`}
        >
          {/* late: ONLY "Ritardo di X g" (the state word "In ritardo" said the same thing twice) */}
          {model.info.level !== 'red' && t(`light.${model.info.level}`)}
          <span className={model.info.level === 'red' ? 'text-base' : 'block text-base'}>{detail}</span>
        </p>
        <button type="button" onClick={onCash} aria-label={t('cash.title')} data-testid="ws-total" className="text-right">
          <span className="block text-3xl font-semibold tabular-nums leading-none text-brand">{model.total === null ? '—' : money(model.total)}</span>
          {model.locked && (
            <span data-testid="ws-lock-chip" className="mt-1 block text-[11px] font-bold text-[#e8c35f]">
              🔒 {t(model.locked === 'signed' ? 'ws.lock.signed' : 'ws.lock.frozen')}
            </span>
          )}
        </button>
      </div>

      {(time.pct !== null && time.pct !== undefined) || (cash.pct !== null && cash.pct !== undefined) || cash.liquid !== 0 ? (
      <div data-testid="ws-meters" className="mb-2 mt-4 grid w-full grid-cols-2 gap-4">
        <Bar id="time" label={t('ws.bar.time')} pct={time.pct} tone={time.tone} text={`${time.elapsed}/${time.of} d`} />
        <Bar
          id="cash"
          className="col-start-2" // Cassa always sits in the right column, even when there is no schedule
          label={t('ws.bar.cash')}
          pct={cash.pct}
          tone={cash.tone}
          text={`${Math.round(cash.pct ?? 0)} %`}
          // the real cash on hand (paid by the client - expenses - worker advances), in the money of THIS project's market
          sub={
            (cash.pct !== null || cash.liquid !== 0) && (
            <span data-testid="cash-liquid" data-liquid={cash.liquid} data-negative={cash.liquid < 0 ? 'true' : undefined} className={`text-sm font-medium ${cash.liquid < 0 ? 'text-[#e8c35f]/80' : 'text-neutral-400'}`}>
              {cash.pct !== null && cash.pct !== undefined && <span aria-hidden="true"> · </span>}
              {money(cash.liquid)}
            </span>
            )
          }
        />
      </div>
      ) : null}

      {model.locked && (
        <button type="button" onClick={onUnlock} data-testid="ws-unlock" className="mt-2 min-h-[40px] w-full rounded-lg border border-[#d4af37]/60 px-3 text-xs font-bold text-[#e8c35f] active:border-[#d4af37]">
          {t('ws.unlock')}
        </button>
      )}
      {offline && (
        <p data-testid="ws-offline" className="mt-2 border-l-2 border-white/30 pl-2 text-[11px] text-[#E0E0E0]/70">
          {t('ws.offlineBase')}
        </p>
      )}
    </header>
  );
}
