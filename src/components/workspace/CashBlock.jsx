import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { LEDGER_LIMITS, cashSummary, newEntryId } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { TextField } from '../ui.jsx';
import Block from './Block.jsx';
import NumberPad from './NumberPad.jsx';

const QUICK = [
  ['25 %', 0.25],
  ['50 %', 0.5],
  ['75 %', 0.75],
];

/**
 * ZONE B, "Anticipos y pagos del cliente": what the client has paid against the budget. The amount is typed on the app's own
 * numpad (never the OS keyboard); while typing the pad says what the Caja bar will read, and the moment the payment is added
 * the bar of Zone A moves (both read cashSummary(total, payments)). Payments are not part of the quote, so this block stays
 * editable while the quote is locked (frozen / signed).
 */
export default function CashBlock({ total, payments, onChange, open, onToggle }) {
  const { t, money, region, locale } = useI18n();
  const [amount, setAmount] = useState(null);
  const [note, setNote] = useState('');
  const [pad, setPad] = useState(false);
  const summary = cashSummary(total, payments);
  const full = payments.length >= LEDGER_LIMITS.payments;
  const ready = amount > 0 && !full;
  const when = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const pctText = (v) => `${Math.round(v)} %`;
  const after = (v) => cashSummary(total, [...payments, { amount: v }]);

  const quick = (f) => {
    const base = f === 1 ? summary.pending : (total || 0) * f;
    setAmount(base > 0 ? Math.round(base * 10 ** region.digits) / 10 ** region.digits : null);
  };
  const add = () => {
    if (!ready) return;
    onChange([{ id: newEntryId(), amount, at: Date.now(), note: note.trim() }, ...payments]);
    setAmount(null);
    setNote('');
  };

  return (
    <Block id="cash" title={t('ws.cash.title')} meta={total > 0 ? pctText(summary.pct) : ''} open={open} onToggle={onToggle} testId="ws-cash">
      <div className="space-y-3" data-testid="cash-panel" data-paid={summary.paid} data-pct={Math.round(summary.pct)}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ['total', t('cash.total'), summary.total],
            ['paid', t('cash.paid'), summary.paid],
            ['pending', t('cash.pending'), summary.pending],
          ].map(([id, label, v]) => (
            <div key={id} className="rounded-xl border border-white/10 px-1 py-2">
              <dt className="text-[11px] font-semibold text-[#E0E0E0]/60">{label}</dt>
              <dd data-testid={`cash-${id}`} className="truncate text-sm font-extrabold tabular-nums">
                {money(v)}
              </dd>
            </div>
          ))}
        </dl>
        {summary.overpaid && (
          <p role="status" className="border-l-2 border-[#e8c35f] pl-2 text-xs font-semibold text-[#e8c35f]" data-testid="cash-over">
            {t('ws.cash.over')}
          </p>
        )}

        <button type="button" onClick={() => setPad(true)} data-testid="cash-amount" className="flex min-h-[52px] w-full items-center justify-between rounded-xl border border-white/15 px-3 active:border-white/50">
          <span className="text-sm text-[#E0E0E0]/70">{t('cash.amount')}</span>
          <span className="text-base font-extrabold tabular-nums">{amount > 0 ? money(amount) : '—'}</span>
        </button>
        {total > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {[...QUICK, [t('cash.rest'), 1]].map(([label, f]) => (
              <button key={label} type="button" onClick={() => quick(f)} data-testid={`cash-quick-${f}`} className="min-h-[44px] rounded-xl border border-white/15 text-sm font-bold active:border-white/50">
                {label}
              </button>
            ))}
          </div>
        )}
        <TextField label={t('cash.note')} optional={t('common.optional')} value={note} onChange={setNote} sanitize={(v) => sanitizeText(v, LEDGER_LIMITS.noteChars)} placeholder={t('cash.notePh')} />
        <button type="button" disabled={!ready} onClick={add} data-testid="cash-add" className="min-h-[52px] w-full rounded-xl border-2 border-brand px-3 text-base font-extrabold text-brand disabled:opacity-40">
          {t('cash.add')}
        </button>

        {payments.length === 0 ? (
          <p className="text-sm text-[#E0E0E0]/60" data-testid="cash-empty">
            {t('ws.cash.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-white/10" data-testid="cash-list">
            {payments.map((p) => (
              <li key={p.id} className="flex min-h-[52px] items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold tabular-nums">{money(p.amount)}</span>
                  <span className="block truncate text-xs text-[#E0E0E0]/60">{[when(p.at), p.note].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" onClick={() => onChange(payments.filter((x) => x.id !== p.id))} aria-label={`${t('common.delete')}: ${money(p.amount)}`} data-testid={`cash-del-${p.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pad && (
        <NumberPad
          testId="cash-pad"
          title={t('ws.cash.pad')}
          unit={region.currency}
          value={amount}
          decimals={region.digits}
          max={LEDGER_LIMITS.maxAmount}
          foot={total > 0 && amount > 0 ? t('ws.cash.after', { pct: pctText(after(amount).pct) }) : ''}
          onChange={setAmount}
          onReset={() => setAmount(null)}
          onClose={() => setPad(false)}
        />
      )}
    </Block>
  );
}
