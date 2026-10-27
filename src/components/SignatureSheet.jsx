import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeText, sanitizeTaxId } from '../lib/sanitize.js';
import { SignatureError, buildSignature, exportSignature } from '../lib/signature.js';
import { Button, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import SignaturePad from './SignaturePad.jsx';

/**
 * Bottom sheet where the client signs with a finger or stylus, plus "Client Name" and "ID:".
 * On accept the ink is exported as a small transparent PNG (base64) and handed back together with the
 * client data and the quote total it vouches for.
 */
export default function SignatureSheet({ signature, total, pricedAt, onSave, onRemove = null, onSkip = null, skipLabel = '', onClose }) {
  const { t } = useI18n();
  const pad = useRef(null);
  const [name, setName] = useState(signature?.name || '');
  const [taxId, setTaxId] = useState(signature?.taxId || '');
  const [error, setError] = useState('');

  const accept = (e) => {
    e.preventDefault();
    if (!pad.current?.hasInk()) return setError(t('sign.err.empty'));
    try {
      const ink = exportSignature(pad.current.getStrokes());
      onSave(buildSignature({ ink, name, taxId, total, pricedAt }));
    } catch (err) {
      setError(t(err instanceof SignatureError && err.code === 'empty' ? 'sign.err.empty' : 'sign.err.store'));
    }
    return undefined;
  };

  return (
    <BottomSheet fullscreen title={t('sign.title')} subtitle={t('sign.sheet.subtitle')} onClose={onClose}>
      <form onSubmit={accept} className="space-y-4">
        <SignaturePad ref={pad} label={t('sign.pad')} placeholder={t('sign.pad.ph')} onInkChange={() => setError('')} className="!h-[40dvh] sm:!h-[44dvh]" />
        <div className="flex justify-end">
          <Button variant="ghost" className="!min-h-[44px] text-sm" onClick={() => pad.current?.clear()} data-testid="signature-clear">
            {t('sign.clear')}
          </Button>
        </div>

        <TextField label={t('sign.name')} value={name} onChange={setName} sanitize={(v) => sanitizeText(v, 60)} />
        <TextField label={t('sign.id')} value={taxId} onChange={setTaxId} maxLength={20} sanitize={sanitizeTaxId} />

        {error && (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" data-testid="signature-accept">
            {t('sign.accept')}
          </Button>
        </div>
        {onSkip && (
          <Button variant="ghost" className="w-full !min-h-[44px] text-sm" onClick={onSkip} data-testid="signature-skip">
            {skipLabel}
          </Button>
        )}
        {onRemove && (
          <Button variant="ghost" className="w-full !min-h-[44px] text-sm" onClick={onRemove} data-testid="signature-remove">
            {t('sign.remove')}
          </Button>
        )}
      </form>
    </BottomSheet>
  );
}
