import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { FINANCE_LIMITS, TAX_LIMITS } from '../../lib/draft.js';
import PercentSlider from '../PercentSlider.jsx';
import Block from './Block.jsx';
import LockedZone from './LockedZone.jsx';
import NumberPad from './NumberPad.jsx';
import { CalculatorIcon, LockIcon, UnlockIcon } from './icons.jsx';

const KEYS = ['labor', 'transport', 'contingency', 'profit'];

/**
 * ZONE B, "Selectores": labour, transport, contingencies and profit as sliders (thumb, no keyboard) and, where the country
 * has no single tax rate (US, CA, BR), the tax typed on the numpad. Read-only while the budget is locked.
 *
 * Error prevention: these values are sensitive and easy to nudge by accident outdoors, so they are LOCKED every time the section is
 * entered (opened or closed again): the sliders and the tax button are disabled (a native <fieldset disabled>), dimmed but with the
 * numbers in full contrast. A big button at the end toggles the lock: grey and quiet when locked, amber while editing.
 */
export default function FinanceBlock({ draft, locked, onBlocked, setDraft, open, onToggle }) {
  const { t, num, region } = useI18n();
  const [pad, setPad] = useState(false);
  const [safe, setSafe] = useState(true); // locked by default
  useEffect(() => {
    setSafe(true); // every time the section opens or closes, the parameters go back to locked
    setPad(false);
  }, [open]);
  const set = (key) => (value) => setDraft((d) => ({ ...d, finance: { ...d.finance, [key]: value } }));
  const official = num(region.taxRate * 100);

  return (
    <Block icon={<CalculatorIcon />} id="finance" title={t('pv.selectors')} open={open} onToggle={onToggle} testId="ws-finance">
      <LockedZone locked={locked} onBlocked={onBlocked} className="space-y-4">
        <fieldset disabled={safe} data-testid="finance-params" data-safe={safe ? 'true' : 'false'} className="m-0 min-w-0 space-y-4 border-0 p-0">
          {KEYS.map((k) => (
            <PercentSlider key={k} label={t(`fin.${k}`)} testId={`slider-${k}`} value={draft.finance[k]} min={FINANCE_LIMITS[k].min} max={FINANCE_LIMITS[k].max} step={FINANCE_LIMITS[k].step} onChange={set(k)} disabled={safe} />
          ))}
          {region.taxEditable && (
            <button type="button" onClick={() => setPad(true)} disabled={safe} data-testid="tax-edit" className={`flex min-h-[52px] w-full items-center justify-between rounded-xl border px-3 ${safe ? 'border-white/10 opacity-70' : 'border-white/15 active:border-white/50'}`}>
              <span className="text-sm text-[#E0E0E0]/70">{t('fin.tax', { name: region.taxName })}</span>
              <span className={`text-base font-extrabold tabular-nums ${safe ? 'text-white' : ''}`}>{draft.finance.tax === null ? `${official} %` : `${num(draft.finance.tax)} %`}</span>
            </button>
          )}
        </fieldset>
      </LockedZone>

      {/* the lock switch, last in the list. While the whole budget is frozen the shield already says so: no second lock then. */}
      {!locked && (
        <button
          type="button"
          onClick={() => {
            setSafe((v) => !v);
            setPad(false);
          }}
          aria-pressed={!safe}
          data-testid="finance-lock"
          data-state={safe ? 'locked' : 'unlocked'}
          className={`mt-4 flex min-h-[60px] w-full items-center justify-center gap-3 rounded-xl border-2 px-4 text-base font-normal transition active:scale-[0.98] ${
            safe ? 'border-neutral-600 text-neutral-400' : 'border-amber-500 text-amber-500'
          }`}
        >
          {safe ? <LockIcon size={26} /> : <UnlockIcon size={26} />}
          <span className="flex flex-col items-start text-left leading-tight">
            <span>{t(safe ? 'ws.params.locked' : 'ws.params.lock')}</span>
            {safe && <span className="text-sm text-neutral-500">{t('ws.params.unlockHint')}</span>}
          </span>
        </button>
      )}
      {pad && (
        <NumberPad
          testId="tax-pad"
          title={t('fin.tax', { name: region.taxName })}
          unit="%"
          value={draft.finance.tax ?? region.taxRate * 100}
          decimals={TAX_LIMITS.decimals}
          max={TAX_LIMITS.max}
          foot={t('fin.tax.desc', { name: region.taxName, rate: official })}
          onChange={set('tax')}
          onReset={() => set('tax')(null)}
          onClose={() => setPad(false)}
        />
      )}
    </Block>
  );
}
