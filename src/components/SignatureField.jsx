import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { isSignatureCurrent } from '../lib/signature.js';
import SignatureSheet from './SignatureSheet.jsx';

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 32;

/**
 * Client column of the summary's signature line. There is NO "Sign" button: the box above the line is
 * the trigger and opens the full-screen signing canvas on a DOUBLE TAP (onDoubleClick for mouse and
 * keyboard-less desktops, plus a pointer-based double-tap detector because not every mobile browser
 * emits `dblclick` for touches). Enter / Space also open it so it stays reachable without a pointer.
 *
 * - Empty: only a subtle `border-white/10` box with a very faint hint (hidden when printing).
 * - Signed: the ink on the line with name / ID / date underneath; double tap again to sign anew
 *   (the sheet offers "Remove signature").
 * - If the quote total changed after signing, the signature is stale: it stays faint on screen with a
 *   notice and it is left out of the PDF (see buildClientModel).
 *
 * `model` is the client report model: it only supplies the printed label and caption.
 */
export default function SignatureField({ model, signature, total, pricedAt, onChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const lastTap = useRef({ at: 0, x: 0, y: 0 });
  const current = isSignatureCurrent(signature, total);
  const shown = model.signature; // only a CURRENT signature is on the model

  const close = () => setOpen(false);
  const save = (next) => {
    onChange(next);
    close();
  };

  const onPointerUp = (e) => {
    if (e.pointerType === 'mouse') return; // the mouse is covered by onDoubleClick
    const now = e.timeStamp;
    const prev = lastTap.current;
    const near = Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_TAP_PX;
    if (now - prev.at <= DOUBLE_TAP_MS && near) {
      lastTap.current = { at: 0, x: 0, y: 0 };
      setOpen(true);
    } else {
      lastTap.current = { at: now, x: e.clientX, y: e.clientY };
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div data-testid="signature-field">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${t('sign.title')}. ${t('sign.hint')}`}
        data-testid="signature-box"
        onDoubleClick={() => setOpen(true)}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        className={`flex h-20 w-full cursor-pointer touch-manipulation select-none items-end justify-center rounded-xl px-2 pb-1 outline-none transition focus-visible:border-brand ${
          signature ? 'border border-transparent' : 'border border-white/10 print:border-transparent'
        }`}
      >
        {signature ? (
          // black ink on transparent: inverted on screen so it reads on the black background
          <img
            src={signature.dataUrl}
            alt=""
            width={signature.w}
            height={signature.h}
            draggable={false}
            className={`sig-img max-h-full w-auto max-w-full object-contain ${current ? '' : 'opacity-30 print:hidden'}`}
            data-testid="signature-preview"
          />
        ) : (
          <span className="no-print flex h-full w-full items-center justify-center text-center text-sm font-light tracking-wide text-white/30" data-testid="signature-hint">
            {t('sign.hint')}
          </span>
        )}
      </div>

      <div className="border-t border-neutral-500 pt-1 text-sm text-neutral-300">
        {model.signClient}
        {shown && (
          <span className="mt-1 block text-xs">
            {shown.name && <b className="block text-white">{shown.name}</b>}
            {shown.idLine && <span className="block">{shown.idLine}</span>}
            {shown.date && <span className="block">{shown.date}</span>}
          </span>
        )}
      </div>

      {signature && !current && (
        <p role="alert" className="no-print mt-2 text-sm font-semibold text-orange-400" data-testid="signature-stale">
          {t('sign.stale')}
        </p>
      )}
      {signature && current && <p className="no-print mt-2 text-xs text-neutral-400">{t('sign.locked')}</p>}

      {open && <SignatureSheet signature={signature} total={total} pricedAt={pricedAt} onSave={save} onRemove={signature ? () => save(null) : null} onClose={close} />}
    </div>
  );
}
