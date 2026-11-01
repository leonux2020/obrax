import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { Button } from './ui.jsx';
import InstallButton from './InstallButton.jsx';

/**
 * How long the opening screen is held and how long its fade-out lasts (ms): ~1.15 s in total, quick enough not to punish the way into
 * the app, long enough for the credit to fade in (TEXT_FADE_MS) and be read.
 */
export const SPLASH_TIMING = Object.freeze({ hold: 900, fade: 250 });

/** The credit fades in over this long. */
export const TEXT_FADE_MS = 500;

/**
 * Opening screen, "Single-Render Splash": the logo (hard hat + CUBRAX) is drawn by the OS from the manifest icon, so this component draws
 * NEITHER the hat NOR the lettering: the centre is plain black (the page's own #000 background) and the user keeps seeing what the OS drew.
 *  - the only visible text is "Un producto Japadigital", position:absolute at the bottom, fading in (opacity 0 -> 1, ~500 ms);
 *  - the name stays in the DOM only as a visually hidden <h1> (screen readers, document outline);
 *  - `auto` (the user already has a profile or a session): it holds for `hold` ms, fades out and calls `onStart`;
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

  // the first paint is bare black, exactly what the OS left on screen; only the credit fades in
  const fadeIn = timing.hold || timing.fade ? { animation: `splash-text-in ${TEXT_FADE_MS}ms ease-out both` } : undefined;

  return (
    <main
      className={`relative h-[100dvh] w-screen overflow-hidden bg-black transition-opacity ease-out ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${timing.fade}ms` }}
      data-testid="splash"
      data-leaving={leaving ? 'true' : undefined}
    >
      <h1 className="sr-only" data-testid="splash-name">
        {t('app.name')}
      </h1>

      <div className="absolute inset-x-0 bottom-0 z-40 px-6 [padding-bottom:max(2rem,env(safe-area-inset-bottom))]">
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
