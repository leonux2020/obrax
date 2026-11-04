import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { isIOS } from '../pwa/installPrompt.js';

/**
 * "Instalar App": visible whenever the app is not installed yet (splash + Ajustes). With the browser's install event
 * it opens the native install dialog; where there is none (iOS Safari, Firefox...) the tap shows how to install by hand.
 */
export default function InstallButton({ pwa, className = '', quiet = false }) {
  const { t } = useI18n();
  const [hint, setHint] = useState('');
  if (!pwa || pwa.installed) return null;

  const tap = async () => {
    const r = await pwa.install();
    setHint(r === 'manual' ? (isIOS() ? 'pwa.hint.ios' : 'pwa.hint.other') : '');
  };
  return (
    <div className={className} data-testid="install-app-wrap">
      <button
        type="button"
        onClick={tap}
        data-testid="install-app"
        data-native={pwa.canInstall ? 'true' : 'false'}
        data-quiet={quiet ? 'true' : undefined}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 transition active:scale-[0.98] ${
          quiet ? 'min-h-[48px] border border-white/10 text-sm font-medium text-neutral-400 hover:text-neutral-200' : 'min-h-[52px] bg-brand text-base font-semibold text-black hover:bg-brand-light'
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {t('pwa.installApp')}
      </button>
      {hint && (
        <p role="status" data-testid="install-hint" className="mt-2 text-center text-sm text-neutral-300">
          {t(hint)}
        </p>
      )}
    </div>
  );
}
