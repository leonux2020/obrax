import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { InvoiceError, overridesFromRows, planInvoicePrices, requestExtraction } from '../lib/invoice.js';
import { PhotoError, compressInvoiceImage } from '../lib/photos.js';
import { Badge, Button } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';

/**
 * PRO flow "Leer factura con IA" (full-height sheet, actions in the thumb zone):
 *   pick (camera / upload)  ->  reading (cancellable)  ->  review (tick what to apply)  ->  onApply(overrides)
 * The photo is compressed on the device and sent ONLY to our own proxy (/api/extract-invoice); the Gemini key
 * never reaches this code. `prepareImage` / `fetchImpl` are injectable for tests.
 */
export default function InvoiceSheet({ quoteItems, taxRate = 0, onApply, onClose, prepareImage = compressInvoiceImage, fetchImpl }) {
  const { t, region, lang, money, unit } = useI18n();
  const [phase, setPhase] = useState('pick'); // 'pick' | 'reading' | 'review'
  const [error, setError] = useState('');
  const [extraction, setExtraction] = useState(null);
  const [selected, setSelected] = useState([]);
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const read = async (file) => {
    setError('');
    setPhase('reading');
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const img = await prepareImage(file);
      const ex = await requestExtraction(img.dataUrl, { currency: region.currency, lang, signal: ctl.signal, ...(fetchImpl ? { fetchImpl } : {}) });
      if (!alive.current) return;
      const plan = planInvoicePrices(ex, { quoteItems, region, taxRate });
      setExtraction({ ...ex, ...plan });
      setSelected(plan.rows.filter((r) => r.selected).map((r) => r.id));
      setPhase('review');
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof InvoiceError && err.code === 'cancelled') {
        setPhase('pick');
        return;
      }
      setError(err instanceof PhotoError ? 'photo' : err instanceof InvoiceError ? err.code : 'upstream');
      setPhase('pick');
    }
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same photo can be chosen again
    if (file) read(file);
  };

  const cancel = () => abortRef.current?.abort();
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const saleUnitOf = (id) => quoteItems.find((q) => q.id === id)?.saleUnit;

  const apply = () => onApply(overridesFromRows(extraction.rows, selected));

  return (
    <BottomSheet fullscreen title={t('inv.title')} subtitle={t('inv.subtitle')} onClose={onClose}>
      <div className="mx-auto max-w-lg" data-testid="invoice-sheet" data-phase={phase}>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="invoice-camera-input" onChange={onFile} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="invoice-file-input" onChange={onFile} />

        {phase === 'pick' && (
          <div className="space-y-3 pb-24">
            {error && (
              <p role="alert" data-testid="invoice-error" data-code={error} className="rounded-xl border border-red-500/60 px-4 py-3 text-sm font-semibold text-red-400">
                {t(`inv.err.${error}`)}
              </p>
            )}
            <Button className="w-full" onClick={() => cameraRef.current?.click()} data-testid="invoice-camera">
              {t('inv.camera')}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()} data-testid="invoice-upload">
              {t('inv.upload')}
            </Button>
            <p className="pt-2 text-xs text-neutral-400">{t('inv.privacy')}</p>
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex flex-col items-center gap-5 py-16 text-center" role="status" data-testid="invoice-reading">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-[#e8c35f]" aria-hidden="true" />
            <p className="text-lg font-bold">{t('inv.reading')}</p>
            <Button variant="ghost" onClick={cancel} data-testid="invoice-cancel">
              {t('inv.cancel')}
            </Button>
          </div>
        )}

        {phase === 'review' && extraction && (
          <div className="space-y-4 pb-28" data-testid="invoice-review">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">{t('inv.results')}</h3>
            {extraction.supplier && <p className="text-sm text-neutral-300">{t('inv.supplier', { name: extraction.supplier })}</p>}
            {extraction.currencyMismatch && (
              <p role="alert" data-testid="invoice-currency" className="rounded-xl border border-red-500/60 px-4 py-3 text-sm font-semibold text-red-400">
                {t('inv.currency', { cur: extraction.currency, proj: region.currency })}
              </p>
            )}
            {extraction.taxIncluded && taxRate > 0 && <p className="text-xs text-neutral-400">{t('inv.taxStripped')}</p>}
            {extraction.rows.length === 0 && !extraction.currencyMismatch && (
              <p className="rounded-xl border border-white/10 px-4 py-3 text-sm text-neutral-300" data-testid="invoice-none">
                {t('inv.none')}
              </p>
            )}

            <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
              {extraction.rows.map((r) => {
                const on = selected.includes(r.id);
                return (
                  <li key={r.id} data-testid={`invoice-row-${r.id}`} data-suspicious={r.suspicious ? 'true' : undefined}>
                    <label className={`flex min-h-[64px] cursor-pointer items-start gap-3 p-4 ${r.selectable ? '' : 'cursor-not-allowed opacity-50'}`}>
                      <input
                        type="checkbox"
                        className="mt-1 h-6 w-6 shrink-0 accent-[#d4af37]"
                        checked={on && r.selectable}
                        disabled={!r.selectable}
                        onChange={() => toggle(r.id)}
                        aria-label={t(`mat.${r.id}`)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold leading-snug">{t(`mat.${r.id}`)}</span>
                        {r.description && <span className="block truncate text-xs text-neutral-400">{r.description}</span>}
                        <span className="mt-1 block text-sm text-neutral-300">{t('inv.was', { price: money(r.refPrice) })}</span>
                        {r.suspicious && (
                          <span className="mt-1 block text-xs font-semibold text-[#e8c35f]" role="note">
                            {t('inv.suspicious')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-lg font-extrabold tabular-nums text-[#e8c35f]">{money(r.price)}</span>
                        {saleUnitOf(r.id) && <span className="block text-xs text-neutral-400">/ {unit(saleUnitOf(r.id))}</span>}
                        {r.lines > 1 && <Badge tone="white">×{r.lines}</Badge>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {extraction.ignored.length > 0 && (
              <p className="text-xs text-neutral-400" data-testid="invoice-ignored">
                {t('inv.ignored', { n: extraction.ignored.length })}
              </p>
            )}

            <div className="sticky bottom-0 -mx-5 border-t border-white/10 bg-black px-5 pb-1 pt-3">
              <div className="mx-auto flex max-w-lg flex-col gap-2">
                <Button className="w-full" disabled={selected.length === 0} onClick={apply} data-testid="invoice-apply">
                  {t('inv.apply', { n: selected.length })}
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setPhase('pick')} data-testid="invoice-retry">
                  {t('inv.retry')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
