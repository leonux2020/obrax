import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { Button } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import HelmetIcon from './HelmetIcon.jsx';

const BENEFITS = [
  { id: 'drive', icon: 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9H7zm5-7v5m0-5-2 2m2-2 2 2' },
  { id: 'ai', icon: 'M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M8 12h8' },
  { id: 'projects', icon: 'M12 12c-2.2-2.7-4.5-3.3-6-2.2-1.6 1.2-1.4 4 .2 5.2 1.6 1.2 3.8.5 5.8-3zm0 0c2.2-2.7 4.5-3.3 6-2.2 1.6 1.2 1.4 4-.2 5.2-1.6 1.2-3.8.5-5.8-3z' },
];

const PLANS = [
  { id: 'yearly', name: 'pro.plan.yearly', price: 'pro.price.yearly', badge: 'pro.plan.save' },
  { id: 'monthly', name: 'pro.plan.monthly', price: 'pro.price.monthly' },
];

/**
 * PRO benefits screen (freemium): a full-height pure-black sheet with the three benefits, two example
 * plans and a "Subscribe" button that is intentionally inactive. "Volver" and "×" always leave it.
 */
export default function ProPaywall({ onClose }) {
  const { t } = useI18n();
  const [plan, setPlan] = useState('yearly');

  return (
    <BottomSheet fullscreen title={t('pro.title')} subtitle={t('pro.subtitle')} onClose={onClose}>
      <div data-testid="pro-paywall" className="mx-auto max-w-lg pb-4">
        <div className="mb-5 mt-1 flex items-center gap-2 text-[#e8c35f]">
          <HelmetIcon size={22} />
          <span className="rounded-md border border-[#d4af37]/60 px-1.5 text-[11px] font-extrabold tracking-wider">PRO</span>
        </div>

        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">{t('pro.benefits')}</h3>
        <ul className="mb-6 divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="pro-benefits">
          {BENEFITS.map((b) => (
            <li key={b.id} className="flex items-start gap-3 p-4">
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
        <div role="radiogroup" aria-labelledby="pro-plans-label" className="grid grid-cols-2 gap-3">
          {PLANS.map((p) => {
            const on = plan === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`pro-plan-${p.id}`}
                onClick={() => setPlan(p.id)}
                className={`relative flex min-h-[96px] flex-col items-start justify-end rounded-2xl border bg-black p-4 text-left transition active:scale-[0.99] ${
                  on ? 'border-[#d4af37]' : 'border-white/10 hover:border-white/40'
                }`}
              >
                {p.badge && (
                  <span className="absolute right-3 top-3 rounded-md border border-[#d4af37]/60 px-1.5 text-[11px] font-bold text-[#e8c35f]">{t(p.badge)}</span>
                )}
                <span className="text-sm font-semibold text-neutral-300">{t(p.name)}</span>
                <span className={`mt-1 text-lg font-extrabold ${on ? 'text-[#e8c35f]' : 'text-white'}`}>{t(p.price)}</span>
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
          <Button variant="ghost" onClick={onClose} data-testid="pro-back" className="w-full">
            {t('pro.back')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
