import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { MAX_PRICE, taxRateFor } from '../../lib/pricing.js';
import { useAiAccess } from '../../lib/usePro.js';
import { usePriceStatus } from '../../lib/usePrices.js';
import { refreshPrices } from '../../lib/priceFeed.js';
import { createRateLimiter, humanVerified } from '../../lib/shield.js';
import { chainLabel } from '../../lib/regions.js';
import { Badge, Button, NumberField } from '../ui.jsx';
import InvoiceSheet from '../InvoiceSheet.jsx';

export default function StepPrices({ draft, setDraft, result, now, onRefresh, onPro }) {
  const { t, region, money, num, unit, time, locale } = useI18n();
  // Genuine user input => 8 refreshes/min; scripted (untrusted-event) sessions => 2/min.
  const humanLimiter = useRef(createRateLimiter(8, 60_000));
  const botLimiter = useRef(createRateLimiter(2, 60_000));
  const [limited, setLimited] = useState(false);
  const feed = usePriceStatus(draft.regionCode);
  const pro = useAiAccess(); // 'pro' | 'dev' (localhost bypass) | null
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [wantsInvoice, setWantsInvoice] = useState(false); // tapped while locked: open the reader as soon as PRO is on
  const [applied, setApplied] = useState(0); // prices loaded from the last invoice

  // The paywall's test switch (or, later, a real purchase) flips PRO while this screen is open: continue where the
  // user left off, with no second tap.
  useEffect(() => {
    if (pro && wantsInvoice) {
      setWantsInvoice(false);
      setInvoiceOpen(true);
    }
  }, [pro, wantsInvoice]);

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
      refreshPrices(draft.regionCode, { force: true }); // ask the price service again (falls back to the last saved values)
    } else setLimited(true);
  };

  // PRO: AI invoice reading. Locked users get the paywall (with the reason) instead of the flow.
  const openInvoice = () => {
    if (pro) setInvoiceOpen(true);
    else {
      setWantsInvoice(true);
      onPro?.('ai');
    }
  };
  const applyInvoice = (overrides) => {
    const n = Object.keys(overrides).length;
    if (n > 0) setDraft((d) => ({ ...d, overrides: { ...d.overrides, ...overrides } }));
    setApplied(n);
    setInvoiceOpen(false);
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
          <p role="status" className={`text-xs ${feed.state === 'cached' ? 'text-[#e8c35f]' : 'text-neutral-400'}`} data-testid="prices-feed" data-state={feed.state}>
            {feed.state === 'loading'
              ? t('prices.live.updating')
              : feed.state === 'fresh' || feed.state === 'cached'
                ? t(feed.state === 'fresh' ? 'prices.live.fresh' : 'prices.live.cached', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(feed.at)) })
                : t('prices.live.sim')}
          </p>
        </div>
        <Button variant="secondary" className="!min-h-[44px]" onClick={refresh}>
          ↻ {t('prices.refresh')}
        </Button>
      </div>
      <div className="rounded-2xl border border-[#d4af37]/60 p-3" data-testid="invoice-card">
        <Button variant="ghost" className="w-full !min-h-[56px] !border-[#d4af37]/60 text-[#e8c35f]" onClick={openInvoice} data-testid="invoice-open">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M8 12h8" />
          </svg>
          {t('inv.cta')}
          {!pro && <span className="rounded-md border border-[#d4af37]/60 px-1.5 text-[11px] font-extrabold tracking-wider">PRO</span>}
          {pro === 'dev' && <span data-testid="ai-dev-badge" className="rounded-md border border-white/30 px-1.5 text-[11px] font-extrabold tracking-wider text-neutral-300">DEV</span>}
        </Button>
        <p className="mt-2 text-xs text-neutral-300">{t('inv.cta.hint')}</p>
        {applied > 0 && (
          <p role="status" data-testid="invoice-applied" className="mt-2 text-sm font-semibold text-brand">
            {t('inv.applied', { n: applied })}
          </p>
        )}
      </div>
      {invoiceOpen && (
        <InvoiceSheet quoteItems={result.quote.items} taxRate={taxRateFor(region, draft.finance)} onApply={applyInvoice} onClose={() => setInvoiceOpen(false)} />
      )}
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
