import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { SignatureError, exportSignature } from '../lib/signature.js';
import { Button } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import SignaturePad from './SignaturePad.jsx';

/**
 * Full-screen canvas where the contractor draws their signature ONCE (from the profile in Ajustes).
 * The exported PNG (black ink, transparent) is handed back as {dataUrl, w, h}; it is then printed
 * automatically on the contractor line of every final document.
 */
export default function ContractorSignatureSheet({ value, onSave, onClose }) {
  const { t } = useI18n();
  const pad = useRef(null);
  const [error, setError] = useState('');

  const accept = (e) => {
    e.preventDefault();
    if (!pad.current?.hasInk()) return setError(t('sign.err.empty'));
    try {
      const ink = exportSignature(pad.current.getStrokes());
      onSave({ dataUrl: ink.dataUrl, w: ink.w, h: ink.h });
    } catch (err) {
      setError(t(err instanceof SignatureError && err.code === 'empty' ? 'sign.err.empty' : 'sign.err.store'));
    }
    return undefined;
  };

  return (
    <BottomSheet fullscreen title={t('sign.pro.sheetTitle')} subtitle={t('sign.pro.sheetSubtitle')} onClose={onClose}>
      <form onSubmit={accept} className="space-y-4" data-testid="contractor-sign-sheet">
        <SignaturePad ref={pad} label={t('sign.pad')} placeholder={t('sign.pad.ph')} onInkChange={() => setError('')} className="!h-[44dvh] sm:!h-[48dvh]" />
        <div className="flex justify-end">
          <Button variant="ghost" className="!min-h-[44px] text-sm" onClick={() => pad.current?.clear()} data-testid="contractor-sign-clear">
            {t('sign.clear')}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" data-testid="contractor-sign-accept">
            {t('sign.accept')}
          </Button>
        </div>
        {value && (
          <Button variant="ghost" className="w-full !min-h-[44px] text-sm" onClick={() => onSave(null)} data-testid="contractor-sign-remove">
            {t('sign.pro.remove')}
          </Button>
        )}
      </form>
    </BottomSheet>
  );
}
