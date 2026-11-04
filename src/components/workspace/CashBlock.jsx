import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { CLIENT_PAYMENT_METHODS, LEDGER_LIMITS, cashSummary, newEntryId } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { pushToast } from '../../lib/notify.js';
import { scrollBehavior } from '../../lib/motion.js';
import { PhotoError } from '../../lib/photos.js';
import { paymentPhotosFor, preparePaymentPhoto } from '../../lib/paymentPhotos.js';
import { TextField } from '../ui.jsx';
import Block from './Block.jsx';
import { NoteThumb, PhotoLightbox, useBlobUrl, useNotePhoto } from './NotePhoto.jsx';
import NumberPad from './NumberPad.jsx';
import { BanknoteIcon, CameraIcon, LandmarkIcon, Outline, ReceiptIcon } from './icons.jsx';

/** A pencil on a line: "add a note". */
const NoteIcon = (props) => (
  <Outline {...props} icon="note">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Outline>
);

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
    <span data-testid="cash-method-tag" data-method={method} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-xs font-normal text-neutral-300">
      <Icon size={13} />
      {t(`ws.cash.m.${method}`)}
    </span>
  );
}

/** One payment of the history: amount, date, how it was paid, the note (if any) and, when it has one, the proof photo that opens full screen. */
function PaymentRow({ payment: p, store, onDelete, onOpenPhoto, when, saving = false }) {
  const { t, money } = useI18n();
  const stored = useNotePhoto(store, p.id, p.photo === true && !saving); // the photo is written in the background: it is read once it has landed
  return (
    <li className="flex min-h-[52px] items-center gap-3 py-1.5" data-testid={`cash-row-${p.id}`} data-method={p.method ?? ''}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-200 tabular-nums">{when(p.at)}</span>
        {(p.method || p.note) && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
            {p.method && <MethodTag method={p.method} />}
            {p.note && <span className="min-w-0 truncate">{p.note}</span>}
          </span>
        )}
      </span>
      <span className="shrink-0 text-sm text-neutral-200 tabular-nums" data-testid={`cash-amount-${p.id}`}>
        <span aria-hidden="true" className="text-neutral-500">+ </span>
        {money(p.amount)}
      </span>
      {p.photo === true &&
        (stored ? (
          <NoteThumb photo={stored} label={t('ws.cash.photoOpen')} onOpen={onOpenPhoto} testId={`cash-thumb-${p.id}`} size={44} bare />
        ) : (
          <span data-testid={`cash-thumb-${p.id}`} data-pending="true" aria-label={t('ws.cash.photoOpen')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neutral-900/50 text-neutral-500">
            <CameraIcon size={20} />
          </span>
        ))}
      <button type="button" onClick={() => onDelete(p)} aria-label={`${t('common.delete')}: ${money(p.amount)}`} data-testid={`cash-del-${p.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-neutral-500 tabular-nums hover:text-red-400 active:text-red-400">
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
  const historyRef = useRef(null);
  const paymentsRef = useRef(payments);
  paymentsRef.current = payments; // the background photo write patches the CURRENT list, never a stale one
  const commit = (list) => {
    paymentsRef.current = list; // visible to the background task before React re-renders
    onChange(list);
  };
  const [amount, setAmount] = useState(null);
  const [quickOn, setQuickOn] = useState(null); // the shortcut chip that produced the amount (null once the amount is typed by hand)
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [shot, setShot] = useState(null); // the prepared proof photo { blob, width, height, ... } waiting for "Registrar pago"
  const shotUrl = useBlobUrl(shot?.blob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState('');
  const [pad, setPad] = useState(false);
  const [saving, setSaving] = useState(() => new Set()); // payments whose proof photo is still being written to the device
  const summary = cashSummary(total, payments);
  const full = payments.length >= LEDGER_LIMITS.payments;
  const ready = amount > 0 && !full && !busy;
  const when = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const pctText = (v) => `${Math.round(v)} %`;
  const after = (v) => cashSummary(total, [...payments, { amount: v }]);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const quick = (f) => {
    const base = f === 1 ? summary.pending : (total || 0) * f;
    setAmount(base > 0 ? Math.round(base * 10 ** region.digits) / 10 ** region.digits : null);
    setQuickOn(base > 0 ? f : null);
  };
  const typed = (v) => {
    setAmount(v);
    setQuickOn(null);
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
  // The payment is registered AT ONCE (optimistic): the list, the Caja bar and the header move in the same render and the form is clean again.
  // Only the proof photo takes time (it is written to the device in the background): while it lands the row shows a quiet placeholder, and if
  // the device refuses it the payment stays (it is money) and just loses its photo flag, with a toast.
  const add = () => {
    if (!ready) return;
    const id = newEntryId();
    const photo = shot;
    commit([{ id, amount, at: Date.now(), note: note.trim(), ...(method ? { method } : {}), ...(photo ? { photo: true } : {}) }, ...paymentsRef.current]);
    if (photo) {
      setSaving((set) => new Set(set).add(id));
      const settle = () => mounted.current && setSaving((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
      store
        .put(id, photo)
        .catch(() => {
          commit(paymentsRef.current.map((x) => (x.id === id ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'photo')) : x)));
          pushToast({ key: 'photo.err.store', tone: 'warn' });
        })
        .finally(settle);
    }
    setAmount(null);
    setQuickOn(null);
    setMethod('');
    setNote('');
    setNoteOpen(false);
    setShot(null);
    setError('');
    // straight to the history: the new payment is its first row
    setTimeout(() => historyRef.current?.scrollIntoView?.({ block: 'start', behavior: scrollBehavior() }), 0);
  };
  const remove = (p) => {
    commit(payments.filter((x) => x.id !== p.id));
    if (p.photo) store.remove(p.id).catch(() => {});
  };

  return (
    <Block icon={<BanknoteIcon size={32} />} label={t('ws.menu.cash')} id="cash" title={t('ws.cash.title')} meta={total > 0 ? pctText(summary.pct) : ''} open={open} onToggle={onToggle} testId="ws-cash">
      <div className="space-y-5" data-testid="cash-panel" data-paid={summary.paid} data-pct={Math.round(summary.pct)}>
        {/* no boxes: what is LEFT is the figure, the quote and what was collected are quiet support text under it */}
        <dl>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-neutral-500">{t('cash.pending')}</dt>
            <dd data-testid="cash-pending" className="min-w-0 truncate text-lg font-medium tabular-nums text-neutral-200">
              {money(summary.pending)}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-neutral-500">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <dt>{t('cash.total')}</dt>
              <dd data-testid="cash-total" className="truncate tabular-nums">
                {money(summary.total)}
              </dd>
            </div>
            <div className="flex min-w-0 items-baseline gap-1.5">
              <dt>{t('cash.paid')}</dt>
              <dd data-testid="cash-paid" className="truncate tabular-nums">
                {money(summary.paid)}
              </dd>
            </div>
          </div>
        </dl>
        {summary.overpaid && (
          <p role="status" className="border-l-2 border-[#e8c35f] pl-2 text-xs font-medium text-[#e8c35f]" data-testid="cash-over">
            {t('ws.cash.over')}
          </p>
        )}

        {/* the amount: big, light, a soft fill and NO border */}
        <button type="button" onClick={() => setPad(true)} data-testid="cash-amount" className="flex min-h-[72px] w-full items-center justify-between gap-3 rounded-2xl bg-neutral-900/50 px-4 text-left transition active:bg-white/10">
          <span className="text-xs text-neutral-500">{t('cash.amount')}</span>
          <span className={`min-w-0 truncate text-3xl font-light tracking-tight tabular-nums ${amount > 0 ? 'text-neutral-200' : 'text-neutral-500'}`}>{amount > 0 ? money(amount) : '—'}</span>
        </button>

        {/* shortcuts: pill chips; the one in use changes tone */}
        {total > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="cash-quick">
            {[...QUICK, [t('cash.rest'), 1]].map(([label, f]) => (
              <button
                key={label}
                type="button"
                onClick={() => quick(f)}
                aria-pressed={quickOn === f && amount > 0}
                data-testid={`cash-quick-${f}`}
                className={`min-h-[44px] rounded-full border-none bg-neutral-900 px-5 text-xs font-medium transition active:bg-white/10 ${quickOn === f && amount > 0 ? 'bg-white/10 text-neutral-200' : 'text-neutral-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* how it was paid: ONE segmented control, no borders between the options; only the active one is lit */}
        <div role="radiogroup" aria-label={t('ws.cash.method')} className="flex gap-1 rounded-full bg-neutral-900 p-1" data-testid="cash-methods">
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
                className={`flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium transition ${on ? 'bg-white/10 text-neutral-100' : 'text-neutral-400 active:text-neutral-200'}`}
              >
                <Icon size={18} />
                <span className="truncate">{t(`ws.cash.m.${m}`)}</span>
              </button>
            );
          })}
        </div>

        {noteOpen && <TextField flat label={t('cash.note')} optional={t('common.optional')} value={note} onChange={setNote} sanitize={(v) => sanitizeText(v, LEDGER_LIMITS.noteChars)} placeholder={t('cash.notePh')} testId="cash-note" />}
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-400" data-testid="cash-error">
            {t(error)}
          </p>
        )}

        {/* the optionals: ONE quiet row of icon + text, right above the register button */}
        <div className="flex items-center gap-5">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="cash-photo-input" onChange={pick} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="cash-photo" className="flex min-h-[44px] min-w-0 items-center gap-1.5 text-xs text-neutral-400 active:text-neutral-200 disabled:opacity-60">
            <CameraIcon size={18} />
            <span className="truncate">{busy ? t('ws.log.photoBusy') : shot ? t('ws.cash.photoChange') : t('ws.cash.photoAdd')}</span>
          </button>
          {shot && shotUrl && (
            <>
              <button type="button" onClick={() => setViewer(shotUrl)} aria-label={t('ws.cash.photoOpen')} data-testid="cash-photo-preview" className="h-9 w-9 shrink-0 overflow-hidden rounded-lg active:opacity-80">
                <img src={shotUrl} alt="" className="h-full w-full object-cover" draggable="false" />
              </button>
              <button type="button" onClick={() => setShot(null)} aria-label={t('ws.cash.photoRemove')} data-testid="cash-photo-remove" className="-ml-3 flex h-11 w-11 shrink-0 items-center justify-center text-neutral-400 active:text-red-400">
                ✕
              </button>
            </>
          )}
          {!noteOpen && (
            <button type="button" onClick={() => setNoteOpen(true)} data-testid="cash-note-open" className="flex min-h-[44px] min-w-0 items-center gap-1.5 text-xs text-neutral-400 active:text-neutral-200">
              <NoteIcon size={18} />
              <span className="truncate">{t('ws.cash.noteAdd')}</span>
            </button>
          )}
        </div>

        <button type="button" disabled={!ready} onClick={add} data-testid="cash-add" className="min-h-[52px] w-full rounded-xl border-none bg-brand px-3 text-base font-semibold text-black hover:bg-brand-light disabled:opacity-40">
          {t('cash.add')}
        </button>

        <div ref={historyRef} data-testid="cash-history">
          {payments.length === 0 ? (
            <p className="text-sm text-neutral-400" data-testid="cash-empty">
              {t('ws.cash.empty')}
            </p>
          ) : (
            <ul className="space-y-1" data-testid="cash-list">
              {payments.map((p) => (
                <PaymentRow key={p.id} payment={p} store={store} onDelete={remove} onOpenPhoto={setViewer} when={when} saving={saving.has(p.id)} />
              ))}
            </ul>
          )}
        </div>
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
          onChange={typed}
          onReset={() => typed(null)}
          onClose={() => setPad(false)}
        />
      )}
    </Block>
  );
}
