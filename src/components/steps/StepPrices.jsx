import { useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { MAX_PRICE } from '../../lib/pricing.js';
import { createRateLimiter, humanVerified } from '../../lib/shield.js';
import { chainLabel } from '../../lib/regions.js';
import { Badge, Button, NumberField } from '../ui.jsx';

export default function StepPrices({ draft, setDraft, result, now, onRefresh }) {
  const { t, region, money, num, unit, time } = useI18n();
  // Genuine user input => 8 refreshes/min; scripted (untrusted-event) sessions => 2/min.
  const humanLimiter = useRef(createRateLimiter(8, 60_000));
  const botLimiter = useRef(createRateLimiter(2, 60_000));
  const [limited, setLimited] = useState(false);

  if (!result.valid) return null;

  const chainName = (id) => chainLabel(region.chains.find((x) => x.id === id) || { id, name: id }, t);
  const cheapest = Math.min(...region.chains.map((c) => result.chainTotals[c.id]));

  const setOverride = (id, n) =>
    setDraft((d) => {
      const overrides = { ...d.overrides };
      if (n !== null && n > 0 && n <= MAX_PRICE) overrides[id] = n;
      else delete overrides[id];
      return { ...d, overrides };
    });

  const refresh = () => {
    const allowed = humanVerified() ? humanLimiter.current() : botLimiter.current();
    if (allowed) {
      setLimited(false);
      onRefresh();
    } else setLimited(true);
  };

  const chips = [
    { id: 'best', label: t('prices.best'), total: result.chainTotals.best },
    ...region.chains.map((c) => ({ id: c.id, label: chainLabel(c, t), total: result.chainTotals[c.id] })),
  ];

  return (
    <section aria-labelledby="prices-title" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="prices-title" className="text-2xl font-bold">
            {t('prices.title')}
          </h2>
          <p className="text-sm text-neutral-300">{t('prices.updated', { time: time(new Date(now)) })}</p>
          <p className="text-xs text-neutral-400" data-testid="prices-auto">
            {t('prices.auto')}
          </p>
        </div>
        <Button variant="secondary" className="!min-h-[44px]" onClick={refresh}>
          ↻ {t('prices.refresh')}
        </Button>
      </div>
      {draft.partidas.length > 1 && <p className="text-sm text-brand">{t('part.consolidated')}</p>}
      {limited && (
        <p role="alert" className="text-sm font-semibold text-red-400">
          {t('prices.rateLimited')}
        </p>
      )}

      <div role="radiogroup" aria-label={t('prices.chain')} className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {chips.map((c) => {
          const active = draft.chainId === c.id;
          const isCheap = c.id !== 'best' && c.total === cheapest;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDraft((d) => ({ ...d, chainId: c.id }))}
              className={`rounded-xl border-2 p-3 text-left transition ${
                active ? 'border-brand bg-brand/10' : 'border-white/10 bg-black hover:border-white/30'
              }`}
            >
              <span className="block truncate text-sm font-bold">{c.label}</span>
              <span className="block text-base font-extrabold tabular-nums">{money(c.total)}</span>
              {isCheap && <Badge>{t('prices.cheapest')}</Badge>}
            </button>
          );
        })}
      </div>

      <ul className="grid gap-3 lg:grid-cols-2">
        {result.quote.items.map((item) => {
          const manual = item.source === 'manual';
          return (
            <li key={item.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold leading-snug">{t(`mat.${item.id}`)}</p>
                  <p className="text-sm text-neutral-300">
                    {t('prices.need')}: {num(item.needWaste, 2)} {unit(item.baseUnit)}
                  </p>
                  <p className="text-sm text-neutral-300">
                    {t('prices.qty')}:{' '}
                    <b className="text-white">
                      {num(item.packs)} {unit(item.saleUnit)}
                    </b>
                    {item.saleSize !== 1 && (
                      <span>
                        {' '}
                        ({num(item.purchased, 2)} {unit(item.baseUnit)})
                      </span>
                    )}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-extrabold tabular-nums">{money(item.total)}</p>
              </div>

              <div className="mt-3 flex items-end gap-2">
                <NumberField
                  className="flex-1"
                  hideLabel
                  label={`${t('prices.override')} - ${t(`mat.${item.id}`)}`}
                  decimals={region.digits === 0 ? 0 : 2}
                  unit={region.currency}
                  placeholder={num(item.refPrice, region.digits)}
                  value={draft.overrides[item.id] ?? null}
                  onChange={(n) => setOverride(item.id, n)}
                />
                {manual && (
                  <Button variant="ghost" className="!min-h-[52px] !px-3 text-sm" onClick={() => setOverride(item.id, null)}>
                    {t('prices.reset')}
                  </Button>
                )}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                <Badge tone={manual ? 'white' : 'green'}>{manual ? t('prices.manual') : t('prices.ref')}</Badge>
                {money(item.refPrice)} / {unit(item.saleUnit)} · {chainName(item.chainId)}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="card flex items-center justify-between border-brand/50">
        <span className="text-lg font-bold">{t('prices.materials')}</span>
        <span className="text-2xl font-extrabold tabular-nums text-brand">{money(result.quote.materials)}</span>
      </div>
      <p className="text-sm text-neutral-400">{t('prices.disclaimer')}</p>
    </section>
  );
}
