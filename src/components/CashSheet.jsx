import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { cashSummary, newEntryId } from '../lib/ledger.js';
import { sanitizeText } from '../lib/sanitize.js';
import { Button, NumberField, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';

/** Control de Caja: register what the client paid (anticipos / abonos) against the budget. */
export default function CashSheet({ total, payments, onChange, onClose }) {
  const { t, money, region, locale } = useI18n();
  const [amount, setAmount] = useState(null);
  const [note, setNote] = useState('');
  const summary = cashSummary(total, payments);
  const when = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');

  const quick = (fraction) => {
    const base = fraction === 1 ? summary.pending : (total || 0) * fraction;
    setAmount(base > 0 ? Math.round(base * 10 ** region.digits) / 10 ** region.digits : null);
  };

  const add = (e) => {
    e.preventDefault();
    if (!(amount > 0)) return;
    onChange([{ id: newEntryId(), amount, at: Date.now(), note: note.trim() }, ...payments]);
    setAmount(null);
    setNote('');
  };

  return (
    <BottomSheet title={t('cash.title')} onClose={onClose}>
      <div className="space-y-4" data-testid="cash-sheet">
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            [t('cash.total'), summary.total],
            [t('cash.paid'), summary.paid],
            [t('cash.pending'), summary.pending],
          ].map(([label, v]) => (
            <div key={label} className="rounded-xl border border-white/10 px-1 py-2">
              <dt className="text-[11px] font-semibold text-neutral-400">{label}</dt>
              <dd className="truncate text-sm font-extrabold tabular-nums">{money(v)}</dd>
            </div>
          ))}
        </dl>

        <form onSubmit={add} className="space-y-3">
          <NumberField label={t('cash.amount')} value={amount} onChange={setAmount} decimals={region.digits} placeholder="0" />
          {total > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {[
                ['25 %', 0.25],
                ['50 %', 0.5],
                ['75 %', 0.75],
                [t('cash.rest'), 1],
              ].map(([label, f]) => (
                <button key={label} type="button" onClick={() => quick(f)} className="min-h-[44px] rounded-xl border border-white/10 text-sm font-bold hover:border-brand">
                  {label}
                </button>
              ))}
            </div>
          )}
          <TextField label={t('cash.note')} optional={t('common.optional')} value={note} onChange={setNote} sanitize={(v) => sanitizeText(v, 80)} placeholder={t('cash.notePh')} />
          <Button type="submit" className="w-full" disabled={!(amount > 0)} data-testid="cash-add">
            {t('cash.add')}
          </Button>
        </form>

        {payments.length > 0 && (
          <ul className="divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="cash-list">
            {payments.map((p) => (
              <li key={p.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold tabular-nums">{money(p.amount)}</span>
                  <span className="block truncate text-xs text-neutral-400">{[when(p.at), p.note].filter(Boolean).join(' · ')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onChange(payments.filter((x) => x.id !== p.id))}
                  aria-label={`${t('common.delete')}: ${money(p.amount)}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-lg text-red-400 hover:border-red-500"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
