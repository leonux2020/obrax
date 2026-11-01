import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo, Wordmark } from './ui.jsx';
import InstallButton from './InstallButton.jsx';

/**
 * How long the opening screen is held and how long its fade-out lasts (ms): ~1.15 s in total, quick enough not to punish the way into
 * the app, long enough for the texts to fade in (TEXT_FADE_MS) and be read.
 */
export const SPLASH_TIMING = Object.freeze({ hold: 900, fade: 250 });

/** The texts (CUBRAX, credit) fade in over this long; the logo never animates. */
export const TEXT_FADE_MS = 500;

/**
 * Logo height (px) whose WIDTH is ~155 px: the size at which Android Chrome draws the manifest icon on its own splash (w-36 ... w-40).
 * The hard hat of the system splash and this one must be the same size in the same place, so the handoff is invisible.
 */
export const SPLASH_LOGO_SIZE = 176;

/**
 * Opening screen. ALWAYS shown when the app opens (installed or not), designed as the continuation of the system splash (Seamless Handoff):
 *  - the hard-hat logo sits at the exact centre of the screen, at the size of the system icon, STATIC (no entrance animation): the eye
 *    keeps seeing the same hat the OS drew;
 *  - only the texts fade in around it (opacity 0 -> 1 in ~500 ms): the CUBRAX lettering (green X) under the logo, and "Un producto Japadigital".
 *  - `auto` (the user already has a profile or a session): it holds for `hold` ms, fades out and calls `onStart`,
 *    so the Dashboard (or the sign-in screen) appears by itself.
 *  - otherwise (first run): the one "Iniciar" button (bottom third, thumb reach) starts the setup.
 * `timing` {hold:0, fade:0} skips the wait (tests).
 */
export default function SplashScreen({ onStart, auto = false, timing = SPLASH_TIMING, pwa = null }) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!auto) return undefined;
    if (!timing.hold && !timing.fade) {
      onStart();
      return undefined;
    }
    let done;
    const out = setTimeout(() => {
      setLeaving(true);
      done = setTimeout(onStart, timing.fade);
    }, timing.hold);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
    // the timer starts once, when the screen appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  // texts only: the first paint is the bare logo on black, exactly like the system splash
  const fadeIn = timing.hold || timing.fade ? { animation: `splash-text-in ${TEXT_FADE_MS}ms ease-out both` } : undefined;

  return (
    <main
      className={`relative min-h-[100dvh] w-full transition-opacity ease-out ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${timing.fade}ms` }}
      data-testid="splash"
      data-leaving={leaving ? 'true' : undefined}
    >
      {/* absolute centre of the screen: nothing else takes part in its position */}
      <div className="absolute inset-0 flex items-center justify-center" data-testid="splash-logo">
        <Logo size={SPLASH_LOGO_SIZE} />
      </div>
      {/* the lettering hangs under the centred logo without moving it */}
      <h1 data-testid="splash-name" className="absolute inset-x-0 top-1/2 flex justify-center text-center" style={{ marginTop: `${Math.round(SPLASH_LOGO_SIZE / 2) + 28}px`, ...fadeIn }}>
        <span className="sr-only">{t('app.name')}</span>
        <Wordmark height={32} />
      </h1>

      <div className="fixed inset-x-0 bottom-0 z-40 px-6 [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          {!auto && (
            <Button className="w-full" onClick={onStart} data-testid="splash-start">
              {t('splash.start')}
            </Button>
          )}
          <InstallButton pwa={pwa} className={auto ? '' : 'mt-3'} />
          <p className="mt-5 text-center text-xs text-neutral-500" data-testid="splash-credit" style={fadeIn}>
            {t('splash.credit')}
          </p>
        </div>
      </div>
    </main>
  );
}
