import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { isSignatureCurrent } from '../lib/signature.js';
import { Button } from './ui.jsx';
import SignatureSheet from './SignatureSheet.jsx';

/**
 * "Client signature" area of the summary screen. Empty: one large touch target that opens the signing
 * sheet. Signed: preview + who signed + re-sign / remove. If the quote total changed after signing the
 * signature is flagged as stale (it is then left out of the PDF, see buildClientModel).
 */
export default function SignatureField({ signature, total, pricedAt, onChange }) {
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const current = isSignatureCurrent(signature, total);

  const save = (next) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <section aria-labelledby="sig-title" className="no-print card" data-testid="signature-field">
      <h3 id="sig-title" className="mb-3 text-lg font-bold">
        {t('sign.title')}
      </h3>

      {!signature ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="signature-open"
          className="flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-xl border border-white/10 px-4 py-4 text-center transition hover:border-brand active:scale-[0.99]"
        >
          <span className="text-lg font-bold text-brand">✍ {t('sign.cta')}</span>
          <span className="text-sm text-neutral-400">{t('sign.cta.hint')}</span>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4 rounded-xl border border-white/10 p-3">
            {/* black ink on transparent: inverted on screen so it reads on the black background */}
            <img src={signature.dataUrl} alt={t('sign.title')} width={signature.w} height={signature.h} className="sig-img h-16 w-auto max-w-[45%] object-contain" data-testid="signature-preview" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="break-words font-bold">{signature.name ? t('sign.signedBy', { name: signature.name }) : t('sign.signed')}</p>
              {signature.taxId && (
                <p className="break-words text-neutral-300">
                  {t('sign.id')} {signature.taxId}
                </p>
              )}
              {signature.at > 0 && <p className="text-neutral-400">{date(new Date(signature.at))}</p>}
            </div>
          </div>
          {current ? (
            <p className="text-xs text-neutral-400">{t('sign.locked')}</p>
          ) : (
            <p role="alert" className="text-sm font-semibold text-orange-400" data-testid="signature-stale">
              {t('sign.stale')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" className="!min-h-[48px] text-sm" onClick={() => setOpen(true)}>
              {t('sign.redo')}
            </Button>
            <Button variant="ghost" className="!min-h-[48px] text-sm" onClick={() => onChange(null)}>
              {t('sign.remove')}
            </Button>
          </div>
        </div>
      )}

      {open && <SignatureSheet signature={signature} total={total} pricedAt={pricedAt} onSave={save} onClose={() => setOpen(false)} />}
    </section>
  );
}
