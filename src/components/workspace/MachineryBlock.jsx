import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { MACHINE_IDS } from '../../lib/machinery.js';
import { flushUserPrices, saveUserPrice } from '../../lib/priceFeed.js';
import { rentRows, toggleMachine, withMachinery } from '../../lib/workspaceModel.js';
import { Switch } from '../ui.jsx';
import Block from './Block.jsx';
import LockedZone from './LockedZone.jsx';
import NumberPad from './NumberPad.jsx';

/**
 * ZONE B, "Maquinaria y arriendos": the heavy equipment the engine suggests (mixer, compactor, scaffold...), one switch per
 * machine and ONE editable daily rate per machine type. The rate is typed on the app's numpad: the quote recalculates at
 * once and the value is saved in IndexedDB as the user's own standard rate (the same hybrid book as the material prices).
 */
export default function MachineryBlock({ draft, result, regionCode, locked, onBlocked, setDraft, open, onToggle }) {
  const { t, money, num, region } = useI18n();
  const [pad, setPad] = useState(null); // machine id
  const rows = rentRows(result);
  const config = draft.machinery ?? { include: true, excluded: [] };
  const total = result.valid ? result.quote.machinery : 0;
  const target = pad ? rows.find((r) => r.id === pad) : null;

  return (
    <Block id="machinery" title={t('ws.mach.title')} meta={total > 0 ? money(total) : ''} open={open} onToggle={onToggle} testId="ws-machinery">
      {rows.length === 0 ? (
        <p className="text-sm text-[#E0E0E0]/60" data-testid="machinery-none">
          {t('mach.none')}
        </p>
      ) : (
        <LockedZone locked={locked} onBlocked={onBlocked} className="space-y-3">
          <Switch data-testid="machinery-master" checked={config.include} onChange={(include) => setDraft((d) => withMachinery(d, { include }))} label={t('mach.include')} description={t('mach.include.desc')} />
          {config.include && (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} data-testid={`rent-${r.id}`} className="space-y-2 border-l-2 border-white/25 pl-3">
                  <Switch
                    data-testid={`machinery-${r.id}`}
                    checked={!config.excluded.includes(r.id)}
                    onChange={(on) => setDraft((d) => withMachinery(d, { excluded: toggleMachine(d.machinery?.excluded, r.id, on) }))}
                    label={`${t(`mach.${r.id}`)} · ${money(r.total)}`}
                    description={`${t(`mach.why.${r.id}`)} ${r.lines.map((i) => t('mach.line', { qty: num(i.qty, 0), days: num(i.days, 0), rate: money(i.rate) })).join(' + ')}`}
                  />
                  <button type="button" onClick={() => setPad(r.id)} data-testid={`rent-rate-${r.id}`} data-source={r.source} className="flex min-h-[52px] w-full items-center justify-between rounded-xl border border-white/15 px-3 active:border-white/50">
                    <span className="text-sm text-[#E0E0E0]/70">{t('ws.mach.rate')}</span>
                    <span className="text-right">
                      <span className="block text-base font-extrabold tabular-nums">{money(r.rate)}</span>
                      <span className="block text-[10px] font-semibold" style={{ color: r.source === 'saved' ? '#e8c35f' : 'rgba(224,224,224,0.6)' }}>
                        {t(`ws.origin.${r.source === 'saved' ? 'user' : r.source === 'ai' ? 'ai' : 'base'}`)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </LockedZone>
      )}
      <p className="mt-3 text-xs text-[#E0E0E0]/60">{t('mach.nohand')}</p>

      {target && MACHINE_IDS.includes(target.id) && (
        <NumberPad
          testId="rent-pad"
          title={t('ws.rent.pad', { name: t(`mach.${target.id}`) })}
          unit={t('ws.rent.per')}
          value={target.rate}
          decimals={region.digits}
          foot={t('ws.rent.foot')}
          onChange={(n) => saveUserPrice(regionCode, 'rent', target.id, n)}
          onReset={() => saveUserPrice(regionCode, 'rent', target.id, null)}
          onClose={() => {
            setPad(null);
            flushUserPrices(); // the last typed rate is written now, not 400 ms later
          }}
        />
      )}
    </Block>
  );
}
