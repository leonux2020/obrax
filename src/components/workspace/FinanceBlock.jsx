import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { FINANCE_LIMITS, TAX_LIMITS } from '../../lib/draft.js';
import PercentSlider from '../PercentSlider.jsx';
import Block from './Block.jsx';
import LockedZone from './LockedZone.jsx';
import NumberPad from './NumberPad.jsx';

const KEYS = ['labor', 'transport', 'contingency', 'profit'];

/**
 * ZONE B, "Selectores": labour, transport, contingencies and profit as sliders (thumb, no keyboard) and, where the country
 * has no single tax rate (US, CA, BR), the tax typed on the numpad. Read-only while the budget is locked.
 */
export default function FinanceBlock({ draft, locked, onBlocked, setDraft, open, onToggle }) {
  const { t, num, region } = useI18n();
  const [pad, setPad] = useState(false);
  const set = (key) => (value) => setDraft((d) => ({ ...d, finance: { ...d.finance, [key]: value } }));
  const official = num(region.taxRate * 100);

  return (
    <Block id="finance" title={t('pv.selectors')} open={open} onToggle={onToggle} testId="ws-finance">
      <LockedZone locked={locked} onBlocked={onBlocked} className="space-y-4">
        {KEYS.map((k) => (
          <PercentSlider key={k} label={t(`fin.${k}`)} testId={`slider-${k}`} value={draft.finance[k]} min={FINANCE_LIMITS[k].min} max={FINANCE_LIMITS[k].max} step={FINANCE_LIMITS[k].step} onChange={set(k)} />
        ))}
        {region.taxEditable && (
          <button type="button" onClick={() => setPad(true)} data-testid="tax-edit" className="flex min-h-[52px] w-full items-center justify-between rounded-xl border border-white/15 px-3 active:border-white/50">
            <span className="text-sm text-[#E0E0E0]/70">{t('fin.tax', { name: region.taxName })}</span>
            <span className="text-base font-extrabold tabular-nums">{draft.finance.tax === null ? `${official} %` : `${num(draft.finance.tax)} %`}</span>
          </button>
        )}
      </LockedZone>
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
