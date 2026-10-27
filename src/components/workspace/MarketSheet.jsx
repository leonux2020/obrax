import { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { REGIONS, regionName, searchRegions } from '../../lib/regions.js';
import BottomSheet from '../BottomSheet.jsx';
import { Button } from '../ui.jsx';

/**
 * "Mercado objetivo" of THIS project: the country whose currency, tax and retailers price the quote and where the AI
 * looks for prices. It does not touch the language of the app. Choosing a country asks one confirmation first, because
 * the prices typed for this project are dropped (they belonged to the old market) and amounts already in payments and
 * expenses are not converted.
 */
export default function MarketSheet({ current, onChange, onClose }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(null); // country code waiting for the confirmation
  const results = useMemo(() => searchRegions(query, lang), [query, lang]);
  const target = pending ? REGIONS[pending] : null;
  const now = REGIONS[current];

  if (target) {
    return (
      <BottomSheet title={t('ws.market.title')} onClose={onClose}>
        <p className="mt-2 text-sm text-[#E0E0E0]" data-testid="market-confirm-text">
          {t('ws.market.confirm', { from: regionName(now, lang), to: `${target.flag} ${regionName(target, lang)}`, currency: target.currency })}
        </p>
        <p className="mt-2 text-xs text-[#E0E0E0]/60" data-testid="market-warning">
          {t('ws.market.warn')}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onChange(target.code)} data-testid="market-confirm">
            {t('ws.market.apply')}
          </Button>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title={t('ws.market.title')} subtitle={t('ws.market.sub')} onClose={onClose}>
      <input
        type="text"
        value={query}
        maxLength={40}
        onChange={(e) => setQuery(e.target.value.slice(0, 40))}
        placeholder={t('region.search')}
        aria-label={t('region.search')}
        data-testid="market-search"
        autoComplete="off"
        className="mt-3 min-h-[48px] w-full rounded-xl border border-white/20 bg-black px-3 text-base text-[#E0E0E0] placeholder:text-[#E0E0E0]/40 focus:border-brand focus:outline-none"
      />
      <ul className="mt-3 max-h-[50vh] divide-y divide-white/10 overflow-y-auto rounded-xl border border-white/10" data-testid="market-list">
        {results.length === 0 && <li className="px-3 py-3 text-sm text-[#E0E0E0]/60">{t('region.noResults')}</li>}
        {results.map((r) => (
          <li key={r.code}>
            <button
              type="button"
              onClick={() => (r.code === current ? onClose() : setPending(r.code))}
              aria-current={r.code === current ? 'true' : undefined}
              data-testid={`market-${r.code}`}
              className={`flex min-h-[52px] w-full items-center gap-3 px-3 text-left active:bg-white/5 ${r.code === current ? 'text-brand' : 'text-[#E0E0E0]'}`}
            >
              <span aria-hidden="true" className="text-xl">
                {r.flag}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{regionName(r, lang)}</span>
              <span className="text-xs text-[#E0E0E0]/60">{r.currency}</span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
