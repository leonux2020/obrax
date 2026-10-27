import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { LEDGER_LIMITS, newEntryId } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { TextField } from '../ui.jsx';
import NumberPad from './NumberPad.jsx';

/**
 * Cash advanced to a worker, discounted from the labour pool that stays visible above it. The name is text (the OS
 * keyboard is the right tool for a name); the AMOUNT is typed on the app's own numpad.
 */
export default function AdvancesPanel({ advances, pool, onChange }) {
  const { t, money, region, locale } = useI18n();
  const [worker, setWorker] = useState('');
  const [amount, setAmount] = useState(null);
  const [pad, setPad] = useState(false);
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const ready = worker.trim() && amount > 0 && advances.length < LEDGER_LIMITS.advances;

  const add = () => {
    if (!ready) return;
    onChange([{ id: newEntryId(), worker: worker.trim(), amount, at: Date.now() }, ...advances]);
    setWorker('');
    setAmount(null);
  };

  return (
    <div className="space-y-3" data-testid="advances-panel">
      <p data-testid="labor-pool" data-available={pool.available} className="text-sm text-[#E0E0E0]/80">
        {t('adv.pool')}: <b className="tabular-nums text-[#E0E0E0]">{money(pool.available)}</b>
        {pool.advanced > 0 && <span className="text-[#e8c35f]"> (−{money(pool.advanced)})</span>}
      </p>
      <p className="label">{t('adv.title')}</p>
      <TextField label={t('adv.worker')} value={worker} onChange={setWorker} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('adv.workerPh')} />
      <button type="button" onClick={() => setPad(true)} data-testid="advance-amount" className="flex min-h-[52px] w-full items-center justify-between rounded-xl border border-white/15 px-3 active:border-white/50">
        <span className="text-sm text-[#E0E0E0]/70">{t('adv.amount')}</span>
        <span className="text-base font-extrabold tabular-nums">{amount > 0 ? money(amount) : '—'}</span>
      </button>
      <button type="button" disabled={!ready} onClick={add} data-testid="advance-add" className="min-h-[52px] w-full rounded-xl border-2 border-brand px-3 text-base font-extrabold text-brand disabled:opacity-40">
        {t('adv.add')}
      </button>
      {advances.length > 0 && (
        <ul className="divide-y divide-white/10" data-testid="advance-list">
          {advances.map((a) => (
            <li key={a.id} className="flex min-h-[52px] items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.worker}</span>
                <span className="block text-xs text-[#E0E0E0]/60">{stamp(a.at)}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{money(a.amount)}</span>
              <button type="button" onClick={() => onChange(advances.filter((x) => x.id !== a.id))} aria-label={`${t('common.delete')}: ${a.worker}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {pad && (
        <NumberPad
          testId="advance-pad"
          title={t('ws.adv.pad')}
          unit={region.currency}
          value={amount}
          decimals={region.digits}
          onChange={setAmount}
          onClose={() => setPad(false)}
        />
      )}
    </div>
  );
}
