import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { MAX_PRICE, taxRateFor } from '../../lib/pricing.js';
import { useAiAccess } from '../../lib/usePro.js';
import { usePriceStatus } from '../../lib/usePrices.js';
import { refreshPrices, saveUserPrice } from '../../lib/priceFeed.js';
import { createRateLimiter, humanVerified } from '../../lib/shield.js';
import { chainLabel } from '../../lib/regions.js';
import { savedMaterial } from '../../lib/priceBook.js';
import { MACHINE_IDS } from '../../lib/machinery.js';
import { Badge, Button, NumberField } from '../ui.jsx';
import InvoiceSheet from '../InvoiceSheet.jsx';

/** Where a price comes from: AI (green spark), the user's own saved price (gold), typed in this project, or the built-in reference. */
function SourceBadge({ source, t }) {
  if (source === 'ai')
    return (
      <span data-testid="src-ai" className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand-light">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
        </svg>
        {t('prices.src.ai')}
      </span>
    );
  if (source === 'saved')
    return (
      <span data-testid="src-saved" className="inline-flex items-center gap-1 rounded-md border border-[#d4af37]/60 px-2 py-0.5 text-xs font-bold text-[#e8c35f]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12l5 5L20 7" />
        </svg>
        {t('prices.src.saved')}
      </span>
    );
  return (
    <span data-testid={source === 'manual' ? 'src-manual' : 'src-ref'} className="rounded-md border border-white/30 bg-white/10 px-2 py-0.5 text-xs font-bold text-white">
      {source === 'manual' ? t('prices.manual') : t('prices.ref')}
    </span>
  );
}

// colour of the data-source indicator: loading (blue, blinking), live AI (green), saved / offline (gold), simulation (grey)
const FEED_TONE = {
  loading: { dot: 'bg-sky-400', text: 'text-sky-300' },
  fresh: { dot: 'bg-brand', text: 'text-neutral-300' },
  cached: { dot: 'bg-[#e8c35f]', text: 'text-[#e8c35f]' },
  sim: { dot: 'bg-white/40', text: 'text-neutral-400' },
};

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

  // The user edits a price: the quote recalculates at once and the value is saved in IndexedDB as THEIR standard price
  // on this device (it beats the AI answer and the simulation from now on). Empty / zero while typing is ignored.
  const regionCode = draft.regionCode;
  const valid = (n) => typeof n === 'number' && n > 0 && n <= MAX_PRICE;
  const editMaterial = (id, n) => {
    if (!valid(n)) return;
    setOverride(id, n); // this project, immediately
    saveUserPrice(regionCode, 'materials', id, n);
  };
  const resetMaterial = (id) => {
    setOverride(id, null);
    saveUserPrice(regionCode, 'materials', id, null);
  };
  const editRent = (id, n) => {
    if (valid(n)) saveUserPrice(regionCode, 'rent', id, n);
  };
  const resetRent = (id) => saveUserPrice(regionCode, 'rent', id, null);

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

  // one editable daily rate per machine type the project uses (a scaffold in two partidas is a single rate)
  const rentRows = MACHINE_IDS.map((id) => {
    const lines = (result.machinery?.items ?? []).filter((i) => i.id === id);
    return lines.length ? { id, lines, rate: lines[0].rate, source: lines[0].source, total: lines.reduce((s, i) => s + i.total, 0) } : null;
  }).filter(Boolean);

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
          {/* where the numbers come from: AI request in flight / saved prices (offline) / simulation mode / live AI */}
          <p
            role="status"
            className={`flex items-center gap-1.5 text-xs ${FEED_TONE[feed.state]?.text || 'text-neutral-400'}`}
            data-testid="prices-feed"
            data-state={feed.state}
            data-reason={feed.reason || undefined}
            title={feed.reason ? `${feed.state}: ${feed.reason}` : undefined}
          >
            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${FEED_TONE[feed.state]?.dot || 'bg-white/20'} ${feed.state === 'loading' ? 'animate-pulse' : ''}`} />
            <span>
              {feed.state === 'loading'
                ? t('prices.live.updating')
                : feed.state === 'fresh' || feed.state === 'cached'
                  ? t(feed.state === 'fresh' ? 'prices.live.fresh' : 'prices.live.cached', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(feed.at)) })
                  : t('prices.live.sim')}
            </span>
          </p>
          {feed.reason === 'not_configured' && (feed.state === 'sim' || feed.state === 'cached') && (
            <p className="text-xs text-neutral-500" data-testid="prices-feed-why">
              {t('prices.live.noKey')}
            </p>
          )}
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
          const typed = item.source === 'manual';
          const isSaved = (typed && savedMaterial(result.book, regionCode, item.id) === item.unitPrice) || item.source === 'saved';
          const origin = isSaved ? 'saved' : item.source; // 'saved' | 'manual' | 'ai' | 'ref'
          const manual = typed || item.source === 'saved';
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
                  placeholder={num(item.unitPrice, region.digits)}
                  value={item.unitPrice}
                  onChange={(n) => editMaterial(item.id, n)}
                />
                {manual && (
                  <Button variant="ghost" className="!min-h-[52px] !px-3 text-sm" onClick={() => resetMaterial(item.id)}>
                    {t('prices.reset')}
                  </Button>
                )}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                <SourceBadge source={origin} t={t} />
                {money(item.refPrice)} / {unit(item.saleUnit)} · {chainName(item.chainId)}
              </p>
            </li>
          );
        })}
      </ul>

      {rentRows.length > 0 && (
        <section aria-labelledby="rent-title" className="space-y-3" data-testid="rent-prices">
          <h3 id="rent-title" className="text-lg font-bold">
            {t('prices.rent.title')}
          </h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {rentRows.map((r) => (
              <li key={r.id} className="card" data-testid={`rent-${r.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold leading-snug">{t(`mach.${r.id}`)}</p>
                    <p className="text-sm text-neutral-300">{r.lines.map((i) => t('mach.line', { qty: num(i.qty, 0), days: num(i.days, 0), rate: money(i.rate) })).join(' + ')}</p>
                  </div>
                  <p className="shrink-0 text-lg font-extrabold tabular-nums">{money(r.total)}</p>
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <NumberField
                    className="flex-1"
                    hideLabel
                    label={t('prices.rent.label', { name: t(`mach.${r.id}`) })}
                    decimals={region.digits === 0 ? 0 : 2}
                    unit={region.currency}
                    placeholder={num(r.rate, region.digits)}
                    value={r.rate}
                    onChange={(n) => editRent(r.id, n)}
                  />
                  {r.source === 'saved' && (
                    <Button variant="ghost" className="!min-h-[52px] !px-3 text-sm" onClick={() => resetRent(r.id)}>
                      {t('prices.reset')}
                    </Button>
                  )}
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                  <SourceBadge source={r.source} t={t} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card flex items-center justify-between border-brand/50">
        <span className="text-lg font-bold">{t('prices.materials')}</span>
        <span className="text-2xl font-extrabold tabular-nums text-brand">{money(result.quote.materials)}</span>
      </div>
      <p className="text-xs text-neutral-400" data-testid="prices-save-hint">
        {t('prices.src.hint')}
      </p>
      <p className="text-sm text-neutral-400">{t('prices.disclaimer')}</p>
    </section>
  );
}
