import { useI18n } from '../lib/i18n.jsx';

/**
 * Profile field "Contractor signature": a box that shows the saved ink (or a faint invitation) and opens the
 * signing canvas with a single tap. The ink is black on transparent, so it sits on a white chip, exactly like
 * the logo thumbnail.
 */
export default function ContractorSignatureField({ value, onOpen }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="pf-sign" className="card space-y-3" data-testid="profile-signature">
      <h2 id="pf-sign" className="text-lg font-bold">
        {t('sign.pro.title')}
      </h2>
      <button
        type="button"
        onClick={onOpen}
        data-testid="profile-signature-box"
        aria-label={`${t('sign.pro.title')}. ${t(value ? 'sign.pro.change' : 'sign.pro.empty')}`}
        className={`flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border px-3 transition active:scale-[0.99] ${
          value ? 'border-white/10 bg-white' : 'border-white/10 bg-black hover:border-white/40'
        }`}
      >
        {value ? (
          <img src={value.dataUrl} alt="" draggable={false} className="max-h-full w-auto max-w-full object-contain" data-testid="profile-signature-preview" />
        ) : (
          <span className="text-sm font-light tracking-wide text-white/40">{t('sign.pro.empty')}</span>
        )}
      </button>
      <p className="text-xs text-neutral-400">{t('sign.pro.hint')}</p>
      {value && (
        <p className="text-xs font-semibold text-brand">{t('sign.pro.change')} ›</p>
      )}
    </section>
  );
}
