import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CLIENT_PAYMENT_METHODS, LEDGER_LIMITS, cashSummary, newEntryId } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { PhotoError } from '../../lib/photos.js';
import { paymentPhotosFor, preparePaymentPhoto } from '../../lib/paymentPhotos.js';
import { TextField } from '../ui.jsx';
import Block from './Block.jsx';
import { NoteThumb, PhotoLightbox, useBlobUrl, useNotePhoto } from './NotePhoto.jsx';
import NumberPad from './NumberPad.jsx';
import { BanknoteIcon, CameraIcon, LandmarkIcon, ReceiptIcon } from './icons.jsx';

// Contanti / Bonifico / Assegno: one tap each, no typing
const METHOD_ICON = { cash: BanknoteIcon, transfer: LandmarkIcon, check: ReceiptIcon };

const QUICK = [
  ['25 %', 0.25],
  ['50 %', 0.5],
  ['75 %', 0.75],
];

/** The method of a payment as a small quiet tag (icon + word) for the history row. */
function MethodTag({ method }) {
  const { t } = useI18n();
  const Icon = METHOD_ICON[method];
  if (!Icon) return null;
  return (
    <span data-testid="cash-method-tag" data-method={method} className="inline-flex items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 text-xs font-semibold text-neutral-300">
      <Icon size={13} />
      {t(`ws.cash.m.${method}`)}
    </span>
  );
}

/** One payment of the history: amount, date, how it was paid, the note (if any) and, when it has one, the proof photo that opens full screen. */
function PaymentRow({ payment: p, store, onDelete, onOpenPhoto, when }) {
  const { t, money } = useI18n();
  const stored = useNotePhoto(store, p.id, p.photo === true);
  return (
    <li className="flex min-h-[52px] items-center gap-3 py-1.5" data-testid={`cash-row-${p.id}`} data-method={p.method ?? ''}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium tabular-nums">{money(p.amount)}</span>
          {p.method && <MethodTag method={p.method} />}
        </span>
        <span className="block truncate text-xs text-neutral-400 tabular-nums">{[when(p.at), p.note].filter(Boolean).join(' · ')}</span>
      </span>
      {p.photo === true &&
        (stored ? (
          <NoteThumb photo={stored} label={t('ws.cash.photoOpen')} onOpen={onOpenPhoto} testId={`cash-thumb-${p.id}`} size={44} />
        ) : (
          <span data-testid={`cash-thumb-${p.id}`} data-pending="true" aria-label={t('ws.cash.photoOpen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/15 text-neutral-500">
            <CameraIcon size={20} />
          </span>
        ))}
      <button type="button" onClick={() => onDelete(p)} aria-label={`${t('common.delete')}: ${money(p.amount)}`} data-testid={`cash-del-${p.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-red-400 tabular-nums">
        ×
      </button>
    </li>
  );
}

/**
 * ZONE B, "Anticipos y pagos del cliente": what the client has paid against the budget. The amount is typed on the app's own
 * numpad (never the OS keyboard); how they paid (Contanti / Bonifico / Assegno) is ONE tap on a chip, the proof (cheque, transfer
 * slip) is a photo from the camera kept on the device (paymentPhotos.js, same pipeline as the logbook photos) and the free note is
 * a quiet optional extra behind a small button. While typing the pad says what the Caja bar will read, and the moment the payment
 * is added the bar of Zone A moves (both read cashSummary(total, payments)). Payments are not part of the quote, so this block
 * stays editable while the quote is locked (frozen / signed).
 */
export default function CashBlock({ total, payments, onChange, open, onToggle, projectId = '_' }) {
  const { t, money, region, locale } = useI18n();
  const store = useMemo(() => paymentPhotosFor(projectId), [projectId]);
  const fileRef = useRef(null);
  const [amount, setAmount] = useState(null);
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [shot, setShot] = useState(null); // the prepared proof photo { blob, width, height, ... } waiting for "Registrar pago"
  const shotUrl = useBlobUrl(shot?.blob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState('');
  const [pad, setPad] = useState(false);
  const summary = cashSummary(total, payments);
  const full = payments.length >= LEDGER_LIMITS.payments;
  const ready = amount > 0 && !full && !busy;
  const when = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const pctText = (v) => `${Math.round(v)} %`;
  const after = (v) => cashSummary(total, [...payments, { amount: v }]);

  const quick = (f) => {
    const base = f === 1 ? summary.pending : (total || 0) * f;
    setAmount(base > 0 ? Math.round(base * 10 ** region.digits) / 10 ** region.digits : null);
  };
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      setShot(await preparePaymentPhoto(file));
    } catch (err) {
      setError(err instanceof PhotoError ? `photo.err.${err.code}` : 'photo.err.store');
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!ready) return;
    const id = newEntryId();
    if (shot) {
      try {
        await store.put(id, shot); // the Blob is on disk BEFORE the payment says it has one
      } catch {
        setError('photo.err.store');
        return;
      }
    }
    onChange([{ id, amount, at: Date.now(), note: note.trim(), ...(method ? { method } : {}), ...(shot ? { photo: true } : {}) }, ...payments]);
    setAmount(null);
    setMethod('');
    setNote('');
    setNoteOpen(false);
    setShot(null);
    setError('');
  };
  const remove = (p) => {
    onChange(payments.filter((x) => x.id !== p.id));
    if (p.photo) store.remove(p.id).catch(() => {});
  };

  return (
    <Block icon={<BanknoteIcon size={32} />} label={t('ws.menu.cash')} id="cash" title={t('ws.cash.title')} meta={total > 0 ? pctText(summary.pct) : ''} open={open} onToggle={onToggle} testId="ws-cash">
      <div className="space-y-3" data-testid="cash-panel" data-paid={summary.paid} data-pct={Math.round(summary.pct)}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ['total', t('cash.total'), summary.total],
            ['paid', t('cash.paid'), summary.paid],
            ['pending', t('cash.pending'), summary.pending],
          ].map(([id, label, v]) => (
            <div key={id} className="rounded-xl border border-white/10 px-1 py-2">
              <dt className="text-xs font-semibold text-neutral-400">{label}</dt>
              <dd data-testid={`cash-${id}`} className="truncate text-sm font-medium tabular-nums">
                {money(v)}
              </dd>
            </div>
          ))}
        </dl>
        {summary.overpaid && (
          <p role="status" className="border-l-2 border-[#e8c35f] pl-2 text-xs font-medium text-[#e8c35f]" data-testid="cash-over">
            {t('ws.cash.over')}
          </p>
        )}

        <button type="button" onClick={() => setPad(true)} data-testid="cash-amount" className="flex min-h-[52px] w-full items-center justify-between rounded-xl border border-white/15 px-3 active:border-white/50">
          <span className="text-sm text-neutral-400">{t('cash.amount')}</span>
          <span className="text-base font-medium tabular-nums">{amount > 0 ? money(amount) : '—'}</span>
        </button>
        {/* shortcuts: deliberately QUIET (hairline border, small regular text) so they never compete with the amount or the confirm button */}
        {total > 0 && (
          <div className="grid grid-cols-4 gap-2" data-testid="cash-quick">
            {[...QUICK, [t('cash.rest'), 1]].map(([label, f]) => (
              <button key={label} type="button" onClick={() => quick(f)} data-testid={`cash-quick-${f}`} className="min-h-[44px] rounded-lg border border-white/10 bg-black text-xs font-medium text-neutral-400 active:border-white/40 active:text-neutral-200">
                {label}
              </button>
            ))}
          </div>
        )}

        <div role="radiogroup" aria-label={t('ws.cash.method')} className="grid grid-cols-3 gap-2" data-testid="cash-methods">
          {CLIENT_PAYMENT_METHODS.map((m) => {
            const Icon = METHOD_ICON[m];
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMethod(on ? '' : m)}
                data-testid={`cash-method-${m}`}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border px-1 text-xs font-semibold transition active:scale-[0.98] ${on ? 'border-brand/60 bg-brand/10 text-brand' : 'border-white/10 bg-white/5 text-neutral-300 active:bg-white/10'}`}
              >
                <Icon size={24} />
                {t(`ws.cash.m.${m}`)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="cash-photo-input" onChange={pick} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="cash-photo" className="flex min-h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-semibold active:border-white/50 disabled:opacity-60">
            <CameraIcon size={22} />
            <span className="truncate">{busy ? t('ws.log.photoBusy') : shot ? t('ws.cash.photoChange') : t('ws.cash.photoAdd')}</span>
          </button>
          {shot && shotUrl && (
            <>
              <button type="button" onClick={() => setViewer(shotUrl)} aria-label={t('ws.cash.photoOpen')} data-testid="cash-photo-preview" className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg border border-white/15 active:border-white/50">
                <img src={shotUrl} alt="" className="h-full w-full object-cover" draggable="false" />
              </button>
              <button type="button" onClick={() => setShot(null)} aria-label={t('ws.cash.photoRemove')} data-testid="cash-photo-remove" className="flex h-11 w-11 shrink-0 items-center justify-center text-neutral-400 active:text-red-400">
                ✕
              </button>
            </>
          )}
        </div>

        {noteOpen ? (
          <TextField label={t('cash.note')} optional={t('common.optional')} value={note} onChange={setNote} sanitize={(v) => sanitizeText(v, LEDGER_LIMITS.noteChars)} placeholder={t('cash.notePh')} testId="cash-note" />
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} data-testid="cash-note-open" className="min-h-[44px] w-full text-left text-xs font-semibold text-neutral-400 active:text-neutral-200">
            {t('ws.cash.noteAdd')}
          </button>
        )}
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-400" data-testid="cash-error">
            {t(error)}
          </p>
        )}
        <button type="button" disabled={!ready} onClick={add} data-testid="cash-add" className="min-h-[52px] w-full rounded-xl px-3 text-base disabled:opacity-40 bg-brand text-black font-semibold hover:bg-brand-light">
          {t('cash.add')}
        </button>

        {payments.length === 0 ? (
          <p className="text-sm text-neutral-400" data-testid="cash-empty">
            {t('ws.cash.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-white/10" data-testid="cash-list">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} store={store} onDelete={remove} onOpenPhoto={setViewer} when={when} />
            ))}
          </ul>
        )}
      </div>

      {viewer && <PhotoLightbox url={viewer} onClose={() => setViewer('')} />}
      {pad && (
        <NumberPad
          testId="cash-pad"
          title={t('ws.cash.pad')}
          unit={region.currency}
          value={amount}
          decimals={region.digits}
          max={LEDGER_LIMITS.maxAmount}
          foot={total > 0 && amount > 0 ? t('ws.cash.after', { pct: pctText(after(amount).pct) }) : ''}
          onChange={setAmount}
          onReset={() => setAmount(null)}
          onClose={() => setPad(false)}
        />
      )}
    </Block>
  );
}
