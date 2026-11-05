import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { sanitizeText } from '../../lib/sanitize.js';
import BottomSheet from '../BottomSheet.jsx';
import NumberPad from './NumberPad.jsx';

/**
 * A DISCOUNT (retention) for one person of the crew: an amount (the app's numpad, never the OS keyboard) and a note, the reason, which is
 * REQUIRED ("Falta", "Herramienta"). It is not a payment: the sheet says so, and the amount never reaches the project's cash. `onSave(amount, note)`.
 */
export default function DiscountSheet({ name, onSave, onClose }) {
  const { t, money, region } = useI18n();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [pad, setPad] = useState(false);
  const ready = amount > 0 && note.trim().length > 0;
  return (
    <>
      <BottomSheet title={`${t('ws.crew.discount')} · ${name}`} autoFocus={false} onClose={onClose}>
        <form
          className="mt-3 space-y-4"
          data-testid="discount-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onSave(amount, note.trim());
          }}
        >
          <div>
            <span className="label">{t('ws.crew.discountAmount')}</span>
            <button
              type="button"
              onClick={() => setPad(true)}
              data-testid="discount-amount"
              data-value={amount}
              className={`flex min-h-[56px] w-full items-center justify-end rounded-xl bg-neutral-900/50 px-4 text-2xl font-medium tabular-nums transition active:bg-white/5 ${amount > 0 ? 'text-neutral-200' : 'text-neutral-500'}`}
            >
              {amount > 0 ? `− ${money(amount)}` : money(0)}
            </button>
          </div>
          <div>
            <label className="label" htmlFor="discount-note">
              {t('ws.crew.discountNote')}
            </label>
            <input
              id="discount-note"
              type="text"
              value={note}
              onChange={(e) => setNote(sanitizeText(e.target.value, 80))}
              maxLength={80}
              placeholder={t('ws.crew.discountNote.ph')}
              autoComplete="off"
              enterKeyHint="done"
              required
              data-testid="discount-note"
              className="field-input min-h-[52px]"
            />
          </div>
          <p className="text-xs text-neutral-400" data-testid="discount-hint">
            {ready ? t('ws.crew.discountHint') : `${t('ws.crew.discountNeed')} ${t('ws.crew.discountHint')}`}
          </p>
          <button type="submit" disabled={!ready} data-testid="discount-save" className="min-h-[56px] w-full rounded-xl bg-brand px-3 text-base font-semibold text-black hover:bg-brand-light disabled:opacity-40">
            {t('ws.crew.discountApply')}
          </button>
        </form>
      </BottomSheet>
      {pad && (
        <NumberPad
          testId="discount-pad"
          title={`${t('ws.crew.discount')} · ${name}`}
          unit={region.currency}
          value={amount > 0 ? amount : null}
          decimals={region.digits}
          onChange={(n) => {
            setAmount(n);
          }}
          onEmpty={() => {
            setAmount(0);
          }}
          onClose={() => setPad(false)}
        />
      )}
    </>
  );
}
