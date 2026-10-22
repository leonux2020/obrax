import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { hseFor } from '../lib/hse.js';
import BottomSheet from './BottomSheet.jsx';
import { Button } from './ui.jsx';

/** Discreet green medical cross inside a thin rounded outline (no emoji: it renders the same everywhere). */
export function HseIcon({ size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 2.8 20 5.6v6c0 4.7-3.2 8.2-8 9.6-4.8-1.4-8-4.9-8-9.6v-6z" />
      <path d="M12 8.2v6.6M8.7 11.5h6.6" />
    </svg>
  );
}

function List({ title, ids, tone }) {
  const { t } = useI18n();
  return (
    <div>
      <h4 className={`mb-2 text-sm font-bold uppercase tracking-wide ${tone === 'brand' ? 'text-brand' : 'text-neutral-400'}`}>{title}</h4>
      <ul className="space-y-2">
        {ids.map((key) => (
          <li key={key} className="flex gap-3 rounded-xl border border-white/10 p-3 text-base leading-snug">
            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone === 'brand' ? 'bg-brand' : 'border border-white/40'}`} />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Bottom sheet with the HSE guide of one task: mandatory / recommended PPE, ergonomics and waste. */
export function HseSheet({ task, onClose }) {
  const { t } = useI18n();
  const g = hseFor(task);
  if (!g) return null;
  return (
    <BottomSheet title={t('hse.title')} subtitle={t('hse.sub', { task: t(`task.${task}`) })} onClose={onClose}>
      <div className="space-y-6" data-testid="hse-sheet">
        <section aria-labelledby="hse-ppe" className="space-y-3">
          <h3 id="hse-ppe" className="text-lg font-bold">
            {t('hse.ppe')}
          </h3>
          <List title={t('hse.mandatory')} ids={g.mandatory} tone="brand" />
          <List title={t('hse.recommended')} ids={g.recommended} />
        </section>
        <section aria-labelledby="hse-ergo" className="space-y-3">
          <h3 id="hse-ergo" className="text-lg font-bold">
            {t('hse.ergo')}
          </h3>
          <List title="" ids={g.ergonomics} tone="brand" />
        </section>
        <section aria-labelledby="hse-waste" className="space-y-3">
          <h3 id="hse-waste" className="text-lg font-bold">
            {t('hse.waste')}
          </h3>
          <List title="" ids={g.waste} tone="brand" />
        </section>
        <p className="text-sm text-neutral-400">{t('hse.disclaimer')}</p>
        <Button variant="secondary" className="w-full" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </BottomSheet>
  );
}

/** Small icon button (44 px touch target) that opens the HSE sheet of `task`. */
export default function HseButton({ task, className = '' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t('hse.open')} · ${t(`task.${task}`)}`}
        title={t('hse.open')}
        data-testid="hse-open"
        className={`no-print flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black text-brand transition hover:border-brand active:scale-95 ${className}`}
      >
        <HseIcon />
      </button>
      {open && <HseSheet task={task} onClose={() => setOpen(false)} />}
    </>
  );
}
