import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { FREE_PROJECT_LIMIT, setSimulatedPro } from '../lib/pro.js';
import { usePro } from '../lib/usePro.js';
import { Button } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import HelmetIcon from './HelmetIcon.jsx';

// Drive backup is FREE (a switch in Ajustes), so it is not listed here.
const BENEFITS = [
  { id: 'ai', icon: 'M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M8 12h8' },
  { id: 'projects', icon: 'M12 12c-2.2-2.7-4.5-3.3-6-2.2-1.6 1.2-1.4 4 .2 5.2 1.6 1.2 3.8.5 5.8-3zm0 0c2.2-2.7 4.5-3.3 6-2.2 1.6 1.2 1.4 4-.2 5.2-1.6 1.2-3.8.5-5.8-3z' },
];

// Example prices. The 2-year plan costs the same per month as the yearly one but asks for a longer
// commitment, so the yearly plan (middle, highlighted, "most popular") is the obvious choice by contrast.
const PLANS = [
  { id: 'monthly', name: 'pro.plan.monthly', price: 'pro.price.monthly' },
  { id: 'yearly', name: 'pro.plan.yearly', price: 'pro.price.yearly', perMonth: '$3.33', badges: ['pro.plan.popular', 'pro.plan.save'], note: 'pro.plan.flex', featured: true },
  { id: 'biennial', name: 'pro.plan.biennial', price: 'pro.price.biennial', perMonth: '$3.33' },
];

/**
 * PRO benefits screen (freemium): a full-height pure-black sheet with the three benefits, two example
 * plans and a "Subscribe" button that is intentionally inactive. "Volver" and "×" always leave it.
 * `feature` ('projects' | 'drive' | 'ai') says which locked function opened it: a short reason is shown and
 * the matching benefit is highlighted. 'promo' (the dashboard button) shows neither.
 */
export default function ProPaywall({ feature = 'promo', onClose }) {
  const { t } = useI18n();
  const [plan, setPlan] = useState('yearly');
  const pro = usePro();

  return (
    <BottomSheet fullscreen title={t('pro.title')} subtitle={t('pro.subtitle')} onClose={onClose}>
      <div data-testid="pro-paywall" className="mx-auto max-w-lg pb-4">
        <div className="mb-5 mt-1 flex items-center gap-2 text-[#e8c35f]">
          <HelmetIcon size={32} />
          <span className="rounded-md border border-[#d4af37]/60 px-1.5 text-[11px] font-extrabold tracking-wider">PRO</span>
        </div>

        {pro && (
          <p role="status" data-testid="pro-active-note" className="mb-4 rounded-xl border border-[#d4af37] px-4 py-3 text-sm font-semibold text-[#e8c35f]">
            {t('pro.active')}
          </p>
        )}

        {feature !== 'promo' && !pro && (
          <p role="status" data-testid="pro-reason" className="mb-4 rounded-xl border border-[#d4af37]/60 px-4 py-3 text-sm font-semibold text-[#e8c35f]">
            {t(`pro.locked.${feature}`, { n: FREE_PROJECT_LIMIT })}
          </p>
        )}

        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">{t('pro.benefits')}</h3>
        <ul className="mb-6 divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="pro-benefits">
          {BENEFITS.map((b) => (
            <li
              key={b.id}
              data-active={feature === b.id ? 'true' : undefined}
              className={`flex items-start gap-3 p-4 ${feature === b.id ? 'shadow-[inset_3px_0_0_#d4af37]' : ''}`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e8c35f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
                <path d={b.icon} />
              </svg>
              <div>
                <p className="font-bold text-white">{t(`pro.b.${b.id}`)}</p>
                <p className="mt-0.5 text-sm text-neutral-300">{t(`pro.b.${b.id}.desc`)}</p>
              </div>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400" id="pro-plans-label">
          {t('pro.plans')}
        </h3>
        <div role="radiogroup" aria-labelledby="pro-plans-label" className="flex flex-col gap-3">
          {PLANS.map((p) => {
            const on = plan === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`pro-plan-${p.id}`}
                data-featured={p.featured ? 'true' : undefined}
                onClick={() => setPlan(p.id)}
                className={`relative flex w-full items-center justify-between gap-3 rounded-2xl bg-black px-4 text-left transition active:scale-[0.99] ${
                  p.featured ? 'min-h-[104px] border-2 py-5' : 'min-h-[72px] border py-3'
                } ${on ? 'border-[#d4af37]' : p.featured ? 'border-[#d4af37]/50' : 'border-white/10 hover:border-white/40'}`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`${p.featured ? 'text-lg' : 'text-base'} font-bold text-white`}>{t(p.name)}</span>
                    {p.badges?.map((bd) => (
                      <span key={bd} className="rounded-md border border-[#d4af37]/60 px-1.5 text-[11px] font-bold text-[#e8c35f]">
                        {t(bd)}
                      </span>
                    ))}
                  </span>
                  {p.perMonth && <span className="mt-0.5 block text-sm text-neutral-300">{t('pro.permonth', { price: p.perMonth })}</span>}
                  {p.note && <span className="block text-xs text-neutral-400">{t(p.note)}</span>}
                </span>
                <span className={`shrink-0 text-right font-extrabold tabular-nums ${p.featured ? 'text-xl' : 'text-base'} ${on || p.featured ? 'text-[#e8c35f]' : 'text-white'}`}>{t(p.price)}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-center text-sm text-neutral-300" data-testid="pro-note">
          {t('pro.note')}
        </p>
      </div>

      {/* thumb zone: inactive subscribe + an always-available way out */}
      <div className="sticky bottom-0 -mx-5 mt-2 border-t border-white/10 bg-black px-5 pb-1 pt-3">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          <Button disabled aria-disabled="true" data-testid="pro-subscribe" className="w-full">
            {t('pro.subscribe')}
          </Button>
          {import.meta.env.DEV && (
            // Development only (dead code in production builds): lets the PRO flows be tried on localhost.
            // Turning PRO on is immediate for the whole app (usePro) and closes this screen.
            <Button
              variant="ghost"
              className="w-full !border-[#d4af37]/60 text-[#e8c35f]"
              data-testid={pro ? 'pro-dev-deactivate' : 'pro-dev-activate'}
              onClick={() => {
                setSimulatedPro(!pro);
                if (!pro) onClose();
              }}
            >
              {t(pro ? 'pro.devDeactivate' : 'pro.devActivate')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} data-testid="pro-back" className="w-full">
            {t('pro.back')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
