import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { MACHINE_IDS } from '../../lib/machinery.js';
import { flushUserPrices } from '../../lib/priceFeed.js';
import { partidaMachines, priceCaption, setMachineOn } from '../../lib/workspaceModel.js';
import LockedZone from './LockedZone.jsx';
import SupplierPad from './SupplierPad.jsx';
import { TractorIcon } from './icons.jsx';

/**
 * "Maquinaria en uso", inside ONE task (partida): the machines the engine assigned to it, each as a quiet row: icon, name, how many
 * units for how many days, its daily rate and its state (in use / excluded). Same data and same forms as the old module:
 *  - the state switch adds / removes the machine from the quote (the switched-off list is per machine type, like its rate);
 *  - the rate opens the app's numpad (SupplierPad); the value is saved as the user's standard daily rate and the quote follows at once.
 * Regular weights, black background, no boxes: nothing here shouts.
 */
export default function PartidaMachinery({ draft, result, index, regionCode, projectLocation = null, locked, onBlocked, setDraft }) {
  const { t, money, num, region } = useI18n();
  const [pad, setPad] = useState(null); // machine id whose daily rate is being typed
  const machines = partidaMachines(result, index, regionCode);
  const target = pad ? machines.find((m) => m.id === pad)?.row : null;

  return (
    <div data-testid={`partida-machinery-${index}`}>
      <p className="label">{t('ws.mach.inUse')}</p>
      {machines.length === 0 ? (
        <p className="text-sm font-normal text-neutral-400" data-testid={`partida-machinery-none-${index}`}>
          {t('mach.none')}
        </p>
      ) : (
        <LockedZone locked={locked} onBlocked={onBlocked} className="">
          <ul className="divide-y divide-white/10">
            {machines.map((m) => {
              const on = m.included;
              const row = m.row;
              return (
                <li key={m.id} data-testid={`partida-machine-${index}-${m.id}`} data-included={on ? 'true' : 'false'} className="flex items-center gap-3 py-3 text-[#E0E0E0]">
                  <span className={on ? 'text-[#E0E0E0]' : 'text-neutral-500'}>
                    <TractorIcon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-base font-normal ${on ? '' : 'text-neutral-500'}`}>{t(`mach.${m.id}`)}</span>
                    <span className="block truncate text-sm font-normal text-neutral-400 tabular-nums">{t('mach.line', { qty: num(m.qty, 0), days: num(m.days, 0), rate: money(m.rate) })}</span>
                    {row?.supplier && (
                      <span data-testid={`partida-machine-supplier-${index}-${m.id}`} className="block truncate text-xs font-normal text-neutral-500">
                        {priceCaption(t, { origin: m.source === 'saved' ? 'user' : m.source === 'ai' ? 'ai' : 'base', meta: row.supplier, regionCode })}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPad(m.id)}
                    data-testid={`partida-machine-rate-${index}-${m.id}`}
                    data-source={m.source}
                    aria-label={`${t('ws.mach.rate')}: ${money(m.rate)}`}
                    className="min-h-[44px] rounded-lg border border-white/15 px-3 text-right text-sm font-normal tabular-nums active:border-white/50"
                  >
                    {money(m.rate)}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${t(`mach.${m.id}`)}: ${t(on ? 'ws.mach.on' : 'ws.mach.off')}`}
                    onClick={() => setDraft((d) => setMachineOn(d, m.id, !on))}
                    data-testid={`partida-machine-toggle-${index}-${m.id}`}
                    className={`flex min-h-[44px] min-w-[84px] items-center justify-end gap-2 text-sm font-normal ${on ? 'text-[#E0E0E0]' : 'text-neutral-500'}`}
                  >
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${on ? 'bg-brand' : 'border border-neutral-500'}`} />
                    {t(on ? 'ws.mach.on' : 'ws.mach.off')}
                  </button>
                </li>
              );
            })}
          </ul>
        </LockedZone>
      )}

      {target && MACHINE_IDS.includes(target.id) && (
        <SupplierPad
          key={target.id}
          regionCode={regionCode}
          kind="rent"
          itemId={target.id}
          projectLocation={projectLocation}
          initialSupplier={target.supplier?.supplierName ?? ''}
          testId="rent-pad"
          title={t('ws.rent.pad', { name: t(`mach.${target.id}`) })}
          unit={t('ws.rent.per')}
          value={target.rate}
          decimals={region.digits}
          foot={t('ws.rent.foot')}
          onClose={() => {
            setPad(null);
            flushUserPrices(); // the last typed rate is written now, not 400 ms later
          }}
        />
      )}
    </div>
  );
}
