import { useI18n } from '../lib/i18n.jsx';
import { LANGS, LANG_NAMES } from '../lib/regions.js';

/** Six-language switcher. Option labels are always in the native language so anyone can find theirs. */
export default function LangSelect({ onChange, className = '', hideLabel = false, label = '' }) {
  const { t, lang } = useI18n();
  return (
    <label className="relative block">
      <span className={hideLabel ? 'sr-only' : 'label'}>{label || t('lang.label')}</span>
      <select
        value={lang}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('lang.switch')}
        title={t('lang.switch')}
        data-testid="lang-select"
        lang={lang}
        className={`min-h-[44px] cursor-pointer rounded-lg border border-neutral-700 bg-black px-3 text-sm font-bold hover:border-brand focus:border-brand ${className}`}
      >
        {LANGS.map((code) => (
          <option key={code} value={code} lang={code} className="bg-black">
            {LANG_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
