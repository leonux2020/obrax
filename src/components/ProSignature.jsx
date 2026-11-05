import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { LockIcon } from './workspace/icons.jsx';
import SignaturePad from './SignaturePad.jsx';

/**
 * The professional's signature canvas, inline in the edit form (minimalist: the pad and one quiet "Limpiar").
 * The stored signature is shown on the pad (white on black) until the user draws or clears; nothing is exported here.
 * `result()` tells the form what to do on Save:
 *   { status: 'keep' }                  untouched: the previous signature stays exactly as it was
 *   { status: 'removed' }               cleared and left empty
 *   { status: 'new', strokes }          drawn: the form exports the strokes to a light transparent PNG (lib/signature.js)
 * The canvas is LOCKED by default: a translucent overlay with a padlock covers it, the page scrolls normally over it and nothing can be drawn by
 * accident. One tap on the overlay unlocks it (only then the pad is `touch-none` and takes the pen).
 * Cancelling the form simply unmounts this component, so the previous signature can never be lost by a cancel.
 */
const ProSignature = forwardRef(function ProSignature({ value }, ref) {
  const { t } = useI18n();
  const pad = useRef(null);
  const [drawn, setDrawn] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
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
          locked={!unlocked}
          label={t('profile.sign.label')}
          placeholder={showCurrent ? '' : t('sign.pad.ph')}
          onInkChange={(v) => {
            setDrawn(v);
            if (v) setRemoved(false);
          }}
          className="!h-36 sm:!h-40"
        />
        {showCurrent && <img src={value.dataUrl} alt="" data-testid="pro-signature-current" className="pointer-events-none absolute inset-0 m-auto max-h-[70%] max-w-[80%] object-contain invert" />}
        {!unlocked && (
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            data-testid="pro-signature-lock"
            aria-label={t('profile.sign.unlock')}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/60 px-4 text-center text-neutral-300"
          >
            <LockIcon size={26} className="text-neutral-400" />
            <span className="text-sm font-light tracking-[0.02em]">{t('profile.sign.unlock')}</span>
          </button>
        )}
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
