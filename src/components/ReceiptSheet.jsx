import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { InvoiceError } from '../lib/invoice.js';
import { EXPENSE_CATEGORIES, RENTAL_CATEGORIES, toAmount } from '../lib/ledger.js';
import { PhotoError, compressInvoiceImage } from '../lib/photos.js';
import { pushToast } from '../lib/notify.js';
import { dropDuplicateReceipts, expensesFromRows, receiptMeta, receiptSumCheck, requestReceipt } from '../lib/receipt.js';
import { applyRates, resolveRate } from '../lib/fx.js';
import { Button, DateInput, NumberField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import Hourglass from './Hourglass.jsx';

/**
 * Offline: when `onQueue` is given and there is no connection (or the request dies on the network), the compressed photo
 * is parked in the deferred queue (phase 'queued') instead of failing; it is read later, silently, by receiptSync.js.
 * "Escanear Boleta con IA" (PRO): photo -> the AI tabulates the lines at once -> the user glances at them -> they are
 * stored in the project as expenses for the rendición. Rented tools / machinery come with the day they go back, which
 * is what lights the hourglass on the project card.
 * The photo is compressed on the device and sent ONLY to our own proxy; the Gemini key never reaches this code.
 */
export default function ReceiptSheet({ onSave, onClose, onQueue, existing = [], prepareImage = compressInvoiceImage, fetchImpl, today = Date.now, resolveFx = resolveRate }) {
  const { t, region, lang, money, moneyIn } = useI18n();
  const [phase, setPhase] = useState('pick'); // 'pick' | 'reading' | 'review'
  const [error, setError] = useState('');
  const [receipts, setReceipts] = useState([]); // ONE photo can hold several receipts: each is an independent record
  const [image, setImage] = useState(null); // the compressed photo that was read: it stays with the expenses (Comprobantes)
  const [rows, setRows] = useState([]);
  const [fxOpen, setFxOpen] = useState({}); // the rate card is collapsed (passive UX): { EUR: true } once the user asks to edit it
  const [fxFailed, setFxFailed] = useState({}); // no rate could be found for this currency: the card opens by itself so it can be typed
  const [fx, setFx] = useState({}); // FX snapshot of the foreign currencies of the batch: { EUR: { rate, source, at } } (the user can retype the rate)
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
      if (onQueue && typeof navigator !== 'undefined' && navigator.onLine === false) {
        await onQueue(img.dataUrl); // no connection: no OCR here, the AI reads it when the network is back
        if (alive.current) setPhase('queued');
        return;
      }
      let batch;
      try {
        batch = await requestReceipt(img.dataUrl, { currency: region.currency, lang, signal: ctl.signal, ...(fetchImpl ? { fetchImpl } : {}) });
      } catch (err) {
        if (onQueue && err instanceof InvoiceError && (err.code === 'network' || err.code === 'timeout')) {
          await onQueue(img.dataUrl); // the line died while reading: keep the photo for later
          if (alive.current) setPhase('queued');
          return;
        }
        throw err;
      }
      if (!alive.current) return;
      // Smart deduplication: a paper already stored in the project (same total + date + shop) is dropped from the batch without asking anything
      const { fresh, skipped } = dropDuplicateReceipts(batch.receipts, existing);
      if (skipped) pushToast({ key: skipped === 1 ? 'rcpt.dup.one' : 'rcpt.dup.many', params: { n: skipped }, tone: 'info' });
      if (!fresh.length) {
        setPhase('pick'); // nothing new in this photo: back to the camera, no error, nothing to delete
        return;
      }
      batch = { ...batch, receipts: fresh };
      let n = 0;
      setReceipts(batch.receipts);
      setImage(img);
      // every line remembers the receipt (`doc`) it was printed on; keys stay sequential across the whole photo
      setRows(batch.receipts.flatMap((r, doc) => r.items.map((it) => ({ ...it, doc, key: `r${n++}`, selected: true }))));
      setPhase('review');
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof InvoiceError && err.code === 'cancelled') {
        setPhase('pick');
        return;
      }
      setError(err instanceof PhotoError ? 'photo' : err instanceof InvoiceError ? err.code : err?.message === 'queue_full' ? 'queue_full' : 'upstream');
      setPhase('pick');
    }
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) read(file);
  };

  // A receipt printed in another currency is frozen into the project's BASE currency when it is saved (fx.js). The rate is looked up in the
  // background as soon as the review opens (service -> last known -> reference table); the user can always type it by hand.
  const foreign = [...new Set(receipts.map((r) => r.currency).filter((c) => c && c !== region.currency))];
  const foreignKey = foreign.join(',');
  useEffect(() => {
    if (phase !== 'review') return undefined;
    let live = true;
    foreign.forEach((cur) => {
      resolveFx(cur, region.currency, { ...(fetchImpl ? { fetchImpl } : {}) })
        .then((r) => {
          if (!live) return;
          if (r) setFx((f) => (f[cur]?.source === 'manual' ? f : { ...f, [cur]: r }));
          else setFxFailed((f) => ({ ...f, [cur]: true }));
        })
        .catch(() => live && setFxFailed((f) => ({ ...f, [cur]: true })));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, foreignKey, region.currency]);
  const fxReady = foreign.every((cur) => fx[cur]?.rate > 0);
  const setRate = (cur, rate) => setFx((f) => ({ ...f, [cur]: { rate: rate > 0 ? rate : 0, source: 'manual', at: Date.now() } }));
  const setBranch = (doc, value) => setReceipts((list) => list.map((r, i) => (i === doc ? { ...r, sucursal: value } : r)));
  const patch = (key, change) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const chosen = rows.filter((r) => r.selected && r.amount !== 0); // a negative line (global discount) counts: it lowers the total
  const total = chosen.reduce((s, r) => s + toAmount(r.amount), 0);

  const save = () => {
    const now = typeof today === 'function' ? today() : today;
    // one independent group of expenses per receipt (its own fiscal data, folio and net / tax split); the project context (id, currency,
    // place) is injected by the project that stores them, so none of them can be orphan
    const groups = receipts.map((r, doc) => ({ r, lines: rows.filter((x) => x.doc === doc) }));
    const printed = groups.flatMap(({ r, lines }) => expensesFromRows(lines, { ...receiptMeta(r), now }));
    const { expenses } = applyRates(printed, { base: region.currency, digits: region.digits, rates: fx, now }); // the amount of a foreign line becomes its frozen base value
    const documents = groups.filter(({ lines }) => lines.some((x) => x.selected && x.amount !== 0)).length;
    onSave(expenses, { ...(image ? { image } : {}), receipts: documents });
    pushToast({ key: documents === 1 ? 'rcpt.toast.one' : 'rcpt.toast.many', params: { n: documents }, tone: 'ok' });
  };
  // the lines of a document add up to MORE than was paid: a discount was probably read as a charge (the user is told, nothing is changed silently)
  const inflated = receipts.map((r, doc) => ({ doc, check: receiptSumCheck(r) })).filter((x) => x.check?.inflated);
  const single = foreign.length === 1 && receipts.every((r) => r.currency === foreign[0]); // the whole batch is in ONE foreign currency: its total is shown as original -> base
  const otherCurrency = receipts.find((r) => r.currency && r.currency !== region.currency)?.currency || '';

  return (
    <BottomSheet fullscreen title={t('rcpt.title')} subtitle={t('rcpt.subtitle')} onClose={onClose}>
      <div className="mx-auto max-w-lg" data-testid="receipt-sheet" data-phase={phase}>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="receipt-camera-input" onChange={onFile} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="receipt-file-input" onChange={onFile} />

        {phase === 'pick' && (
          <div className="space-y-3 pb-24">
            {error && (
              <p role="alert" data-testid="receipt-error" data-code={error} className="rounded-xl border border-red-500/60 px-4 py-3 text-sm font-semibold text-red-400">
                {t(error === 'not_invoice' ? 'inv.err.not_receipt' : `inv.err.${error}`)}
              </p>
            )}
            <Button className="w-full" onClick={() => cameraRef.current?.click()} data-testid="receipt-camera">
              {t('inv.camera')}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()} data-testid="receipt-upload">
              {t('inv.upload')}
            </Button>
            <p className="pt-2 text-xs text-neutral-400">{t('inv.privacy')}</p>
          </div>
        )}

        {phase === 'queued' && (
          <div className="space-y-4 py-10 text-center" role="status" data-testid="receipt-queued">
            <p className="text-lg font-medium text-[#e8c35f]">{t('q.parked')}</p>
            <p className="text-sm text-neutral-300">{t('q.parkedHint')}</p>
            <Button className="w-full" onClick={() => setPhase('pick')} data-testid="receipt-another">
              {t('q.another')}
            </Button>
            <Button variant="secondary" className="w-full" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex flex-col items-center gap-5 py-16 text-center" role="status" data-testid="receipt-reading">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-[#e8c35f]" aria-hidden="true" />
            <p className="text-lg font-medium">{t('inv.reading')}</p>
            <Button variant="secondary" onClick={() => abortRef.current?.abort()} data-testid="receipt-cancel">
              {t('inv.cancel')}
            </Button>
          </div>
        )}

        {phase === 'review' && receipts.length > 0 && (
          <div className="space-y-4 pb-32" data-testid="receipt-review">
            {receipts.length === 1 && receipts[0].supplier && <p className="text-sm text-neutral-300">{t('inv.supplier', { name: receipts[0].supplier })}</p>}
            {receipts.length > 1 && (
              <p role="status" data-testid="receipt-batch" className="text-sm font-medium text-[#e8c35f]">
                {t('rcpt.batch', { n: receipts.length })}
              </p>
            )}
            {otherCurrency && (
              <p role="alert" data-testid="receipt-currency" className="rounded-xl border border-[#d4af37]/60 px-4 py-3 text-sm font-medium text-[#e8c35f]">
                {t('inv.currency', { cur: otherCurrency, proj: region.currency })}
              </p>
            )}
            {foreign.map((cur) =>
              fxOpen[cur] || (fxFailed[cur] && !(fx[cur]?.rate > 0)) ? (
                <div key={cur} data-testid={`receipt-fx-${cur}`} className="space-y-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-sm font-medium">{t('fx.rate', { cur })}</p>
                  <NumberField hideLabel label={t('fx.rate', { cur })} unit={region.currency} decimals={6} value={fx[cur]?.rate ?? null} onChange={(v) => setRate(cur, v)} testId={`receipt-fx-rate-${cur}`} />
                  <p className="text-xs text-neutral-400" data-testid={`receipt-fx-src-${cur}`} data-source={fx[cur]?.source || 'loading'}>
                    {t(`fx.src.${fx[cur]?.source || 'loading'}`)}
                  </p>
                </div>
              ) : (
                // the rate is the system's business: only a quiet link, for the one who needs to correct it
                <div key={cur} className="text-right" data-testid={`receipt-fx-link-${cur}`} data-source={fx[cur]?.source || 'loading'}>
                  <button type="button" onClick={() => setFxOpen((o) => ({ ...o, [cur]: true }))} data-testid={`receipt-fx-edit-${cur}`} className="min-h-[44px] px-2 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300">
                    {t('fx.edit')}
                  </button>
                </div>
              )
            )}
            {inflated.map(({ doc, check }) => (
              <p key={doc} role="alert" data-testid="receipt-sum-warn" className="rounded-xl border border-orange-500/40 bg-orange-500/5 px-4 py-3 text-sm text-orange-400">
                {t('rcpt.sumWarn', { sum: money(check.itemsSum), total: money(check.total) })}
              </p>
            ))}
            <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
              {rows.map((r, idx) => {
                const rental = RENTAL_CATEGORIES.includes(r.category);
                const first = idx === 0 || rows[idx - 1].doc !== r.doc;
                const head = receipts.length > 1 && first ? receipts[r.doc] : null;
                return (
                  <React.Fragment key={r.key}>
                    {head && (
                      <li role="presentation" data-testid={`receipt-doc-${r.doc}`} className="bg-white/5 px-4 py-2 text-xs font-medium uppercase text-[#e8c35f] tabular-nums">
                        {t('rcpt.doc', { i: r.doc + 1, n: receipts.length })}
                        {[head.supplier, head.documentNumber, head.total ? money(head.total) : ''].filter(Boolean).map((x) => ` · ${x}`).join('')}
                      </li>
                    )}
                    {first && (
                      <li role="presentation" className="px-4 py-3">
                        <label className="label" htmlFor={`branch-${r.doc}`}>
                          {t('rcpt.branch')}
                        </label>
                        <input
                          id={`branch-${r.doc}`}
                          type="text"
                          maxLength={80}
                          autoComplete="off"
                          className="field-input"
                          value={receipts[r.doc]?.sucursal ?? ''}
                          onChange={(e) => setBranch(r.doc, e.target.value)}
                          data-testid={`receipt-branch-${r.doc}`}
                        />
                      </li>
                    )}
                  {r.amount < 0 ? (
                    // a DISCOUNT (negative line): shown as a deduction in green, never as a charge; it can be unticked but not retyped
                    <li data-testid={`receipt-row-${r.key}`} data-discount="true" className={`p-4 ${r.selected ? '' : 'opacity-50'}`}>
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[#d4af37]" checked={r.selected} onChange={() => patch(r.key, { selected: !r.selected })} aria-label={r.description || t('rcpt.discount')} />
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="block font-semibold">{r.description || t('rcpt.discount')}</span>
                          <span className="block text-xs text-neutral-400">{t('rcpt.discount')}</span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums text-brand-500" data-testid={`receipt-discount-${r.key}`}>
                          {moneyIn(r.amount, receipts[r.doc]?.currency)}
                        </span>
                      </label>
                    </li>
                  ) : (
                  <li data-testid={`receipt-row-${r.key}`} className={`space-y-3 p-4 ${r.selected ? '' : 'opacity-50'}`}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[#d4af37]" checked={r.selected} onChange={() => patch(r.key, { selected: !r.selected })} aria-label={r.description || t(`exp.cat.${r.category}`)} />
                      <span className="min-w-0 flex-1 font-semibold leading-snug">{r.description || t(`exp.cat.${r.category}`)}</span>
                      {rental && <Hourglass label={t('rental.badge')} size={20} />}
                    </label>
                    <div className="grid grid-cols-2 gap-3 pl-9">
                      <NumberField label={t('rcpt.amount')} value={r.amount} decimals={region.digits} onChange={(v) => patch(r.key, { amount: v ?? 0 })} />
                      <div>
                        <label className="label" htmlFor={`cat-${r.key}`}>
                          {t('rcpt.category')}
                        </label>
                        <select
                          id={`cat-${r.key}`}
                          value={r.category}
                          onChange={(e) => patch(r.key, { category: e.target.value, returnDate: RENTAL_CATEGORIES.includes(e.target.value) ? r.returnDate : '' })}
                          className="field-input"
                          data-testid={`receipt-cat-${r.key}`}
                        >
                          {EXPENSE_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {t(`exp.cat.${c}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {rental && (
                        <div className="col-span-2">
                          <label className="label tabular-nums" htmlFor={`ret-${r.key}`}>
                            {t('rental.returnOn')}
                          </label>
                          <DateInput id={`ret-${r.key}`} value={r.returnDate} onChange={(e) => patch(r.key, { returnDate: e.target.value })} data-testid={`receipt-return-${r.key}`} />
                        </div>
                      )}
                    </div>
                  </li>
                  )}
                  </React.Fragment>
                );
              })}
            </ul>

            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black px-5 pb-3 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto flex max-w-lg flex-col gap-2">
                <Button className="w-full" disabled={chosen.length === 0 || !fxReady} onClick={save} data-testid="receipt-save">
                  {t('rcpt.save', { n: chosen.length })}
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => setPhase('pick')} data-testid="receipt-retry">
                  {t('inv.retry')}
                </Button>
              </div>
            </div>
            <p className="text-right text-sm font-medium tabular-nums" data-testid="receipt-total">
              {t('rcpt.total')}: {single ? moneyIn(total, foreign[0]) : money(total)}
              {single && fx[foreign[0]]?.rate > 0 && (
                <span data-testid="receipt-total-base" className="text-neutral-300">
                  {' → ≈ '}
                  {money(total * fx[foreign[0]].rate)}
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
