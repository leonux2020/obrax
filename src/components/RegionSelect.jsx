import { useState } from 'react';
import { REGIONS, regionName } from '../lib/regions.js';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo } from './ui.jsx';

export default function RegionSelect({ initial, onConfirm, onCancel }) {
  const { t, lang } = useI18n();
  const [code, setCode] = useState(initial || null);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 flex items-center gap-4">
        <Logo size={64} />
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t('app.name')}</h1>
          <p className="text-neutral-300">{t('app.tagline')}</p>
        </div>
      </header>

      <h2 className="text-2xl font-bold">{t('region.title')}</h2>
      <p className="mb-5 mt-1 text-neutral-300">{t('region.subtitle')}</p>

      <ul className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('region.title')}>
        {Object.values(REGIONS).map((r) => {
          const active = code === r.code;
          return (
            <li key={r.code}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCode(r.code)}
                className={`w-full rounded-2xl border-2 p-4 text-left transition ${
                  active ? 'border-brand bg-brand/10' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-lg text-base font-black ${
                      active ? 'bg-brand text-black' : 'bg-neutral-800 text-white'
                    }`}
                  >
                    {r.code}
                  </span>
                  <div className="min-w-0">
                    <div className="text-lg font-bold">{regionName(r, lang)}</div>
                    <div className="text-sm text-neutral-300">
                      {t('region.currency')}: <b className="text-white">{r.currency}</b>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm text-neutral-300">{r.chains.map((c) => c.name).join(' · ')}</p>
              </button>
            </li>
          );
        })}
      </ul>

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
