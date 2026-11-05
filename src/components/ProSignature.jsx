import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import SignaturePad from './SignaturePad.jsx';

/**
 * The professional's signature canvas, inline in the edit form (minimalist: the pad and one quiet "Limpiar").
 * The stored signature is shown on the pad (white on black) until the user draws or clears; nothing is exported here.
 * `result()` tells the form what to do on Save:
 *   { status: 'keep' }                  untouched: the previous signature stays exactly as it was
 *   { status: 'removed' }               cleared and left empty
 *   { status: 'new', strokes }          drawn: the form exports the strokes to a light transparent PNG (lib/signature.js)
 * Cancelling the form simply unmounts this component, so the previous signature can never be lost by a cancel.
 */
const ProSignature = forwardRef(function ProSignature({ value }, ref) {
  const { t } = useI18n();
  const pad = useRef(null);
  const [drawn, setDrawn] = useState(false);
  const [removed, setRemoved] = useState(false);
  const showCurrent = Boolean(value) && !drawn && !removed;

  useImperativeHandle(
    ref,
    () => ({
      result: () => {
        if (pad.current?.hasInk()) return { status: 'new', strokes: pad.current.getStrokes() };
        return { status: removed ? 'removed' : 'keep' };
      },
    }),
    [removed]
  );

  const clear = () => {
    pad.current?.clear();
    setDrawn(false);
    setRemoved(true);
  };

  return (
    <div data-testid="pro-signature">
      <span className="mb-1.5 block text-sm font-medium text-neutral-300">{t('profile.sign.label')}</span>
      <div className="relative">
        <SignaturePad
          ref={pad}
          label={t('profile.sign.label')}
          placeholder={showCurrent ? '' : t('sign.pad.ph')}
          onInkChange={(v) => {
            setDrawn(v);
            if (v) setRemoved(false);
          }}
          className="!h-36 sm:!h-40"
        />
        {showCurrent && <img src={value.dataUrl} alt="" data-testid="pro-signature-current" className="pointer-events-none absolute inset-0 m-auto max-h-[70%] max-w-[80%] object-contain invert" />}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={clear} data-testid="pro-signature-clear" className="min-h-[44px] bg-transparent px-2 text-sm text-neutral-400 transition hover:text-neutral-200">
          {t('profile.sign.clear')}
        </button>
      </div>
    </div>
  );
});

export default ProSignature;
