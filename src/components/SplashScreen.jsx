import { useEffect } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo } from './ui.jsx';
import InstallButton from './InstallButton.jsx';

/**
 * Welcome screen, reduced to the minimum. It is ONLY for the first visit in a browser tab (a brand-new profile): plain black, the CUBRAX
 * stacked imagotype (hard hat + ruler with CUBRAX and its green X centred under them, one SVG, w-56 h-auto) centred above one "Iniciar" button in the thumb
 * zone and the install button. No credit, no timer, no animation and no fade-out. An installed app never mounts it (App starts in the main view or the setup), and
 * neither does anybody who already has a profile or a session.
 * `auto` (coming back from Google's consent redirect): continue at once, in the same frame, without waiting for a tap or a timer.
 */
export default function SplashScreen({ onStart, auto = false, pwa = null }) {
  const { t } = useI18n();

  useEffect(() => {
    if (auto) onStart();
    // runs once, when the screen appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-black" data-testid="splash">
      <h1 className="sr-only" data-testid="splash-name">
        {t('app.name')}
      </h1>
      <div className="absolute inset-x-0 bottom-0 z-40 px-6 [padding-bottom:max(2rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          {!auto && (
            <div className="mx-auto mb-16 flex justify-center" data-testid="splash-logo">
              <Logo variant="stacked" className="mx-auto h-auto max-h-[42dvh] w-56 sm:w-64" />
            </div>
          )}
          {!auto && (
            <Button className="w-full" onClick={onStart} data-testid="splash-start">
              {t('splash.start')}
            </Button>
          )}
          <InstallButton pwa={pwa} className={auto ? '' : 'mt-3'} />
        </div>
      </div>
    </main>
  );
}
