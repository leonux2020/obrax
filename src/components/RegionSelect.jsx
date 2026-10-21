import { useState } from 'react';
import { REGIONS, regionName } from '../lib/regions.js';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo } from './ui.jsx';
import RegionCombobox from './RegionCombobox.jsx';

const pct = (rate) => `${Math.round(rate * 1000) / 10}%`;

export default function RegionSelect({ initial, onConfirm, onCancel }) {
  const { t, lang } = useI18n();
  const [code, setCode] = useState(initial || null);
  const region = code ? REGIONS[code] : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-8">
      <header className="mb-6 flex items-center gap-4">
        <Logo size={56} />
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('app.name')}</h1>
          <p className="text-neutral-300">{t('app.tagline')}</p>
        </div>
      </header>

      <p className="mb-4 text-neutral-300">{t('region.subtitle')}</p>
      <RegionCombobox value={code} onChange={setCode} />

      {region && (
        <section aria-label={t('region.selected')} className="card mt-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none" aria-hidden="true">
              {region.flag}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xl font-bold">{regionName(region, lang)}</p>
              <p className="text-sm text-neutral-300">
                {t('region.currency')}: <b className="text-white">{region.currency}</b> ({region.symbol}) ·{' '}
                {t('region.vat')} {region.taxName}: <b className="text-white">{pct(region.taxRate)}</b>
                {region.taxEditable && <span className="text-brand"> · {t('region.taxEditable')}</span>}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-neutral-300">
            <span className="font-semibold text-white">{t('region.chains')}:</span>{' '}
            {region.chains.map((c) => c.name).join(' · ')}
          </p>
          {region.generic && <p className="mt-1 text-xs text-neutral-400">{t('region.genericChains')}</p>}
        </section>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto flex gap-3 bg-black/95 px-4 py-4">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('common.back')}
          </Button>
        )}
        <Button className="flex-1" disabled={!code} onClick={() => onConfirm(code)}>
          {t('region.continue')}
        </Button>
      </div>
    </main>
  );
}
