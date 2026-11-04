import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { FINANCE_LIMITS, TAX_LIMITS } from '../../lib/draft.js';
import { EditToggle } from '../EditControls.jsx';
import PercentSlider from '../PercentSlider.jsx';
import Block from './Block.jsx';
import LockedZone from './LockedZone.jsx';
import NumberPad from './NumberPad.jsx';
import { CalculatorIcon } from './icons.jsx';

const KEYS = ['labor', 'transport', 'contingency', 'profit'];

/**
 * ZONE B, "Selectores": labour, transport, contingencies and profit as sliders (thumb, no keyboard) and, where the country
 * has no single tax rate (US, CA, BR), the tax typed on the numpad. Read-only while the budget is locked.
 *
 * Error prevention: these values are sensitive and easy to nudge by accident outdoors, so they are LOCKED every time the section is
 * entered (opened or closed again): the sliders and the tax button are disabled (a native <fieldset disabled>), dimmed but with the
 * numbers in full contrast. The pencil in the header of the sheet turns the edit mode on (a check while it is on); there is no lock button.
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
  // the pencil of the header (no box) turns the edit mode on / off; while the whole budget is frozen the shield already says so, so it is off
  const editToggle = (
    <EditToggle
      active={!safe}
      disabled={Boolean(locked)}
      onToggle={() => {
        setSafe((v) => !v);
        setPad(false);
      }}
      label={t('params.edit')}
      doneLabel={t('crew.edit.done')}
      testId="finance-edit-toggle"
    />
  );

  return (
    <Block icon={<CalculatorIcon size={32} />} label={t('ws.menu.finance')} id="finance" title={t('pv.selectors')} open={open} onToggle={onToggle} testId="ws-finance" headerAction={editToggle}>
      <LockedZone locked={locked} onBlocked={onBlocked} className="space-y-4">
        <fieldset disabled={safe} data-testid="finance-params" data-safe={safe ? 'true' : 'false'} className="m-0 min-w-0 space-y-4 border-0 p-0">
          {KEYS.map((k) => (
            <PercentSlider key={k} label={t(`fin.${k}`)} testId={`slider-${k}`} value={draft.finance[k]} min={FINANCE_LIMITS[k].min} max={FINANCE_LIMITS[k].max} step={FINANCE_LIMITS[k].step} onChange={set(k)} disabled={safe} />
          ))}
          {region.taxEditable && (
            <button type="button" onClick={() => setPad(true)} disabled={safe} data-testid="tax-edit" className={`flex min-h-[52px] w-full items-center justify-between rounded-xl border px-3 ${safe ? 'border-white/10 opacity-70' : 'border-white/15 active:border-white/50'}`}>
              <span className="text-sm text-neutral-400 tabular-nums">{t('fin.tax', { name: region.taxName })}</span>
              <span className={`text-base font-medium tabular-nums ${safe ? 'text-neutral-200' : ''}`}>{draft.finance.tax === null ? `${official} %` : `${num(draft.finance.tax)} %`}</span>
            </button>
          )}
        </fieldset>
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
