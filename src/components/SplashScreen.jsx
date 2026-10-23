import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo } from './ui.jsx';

/** How long the opening screen is held and how long its fade-out lasts (ms). */
export const SPLASH_TIMING = Object.freeze({ hold: 1500, fade: 450 });

/**
 * Opening screen: ONLY the logo and "Un producto Japadigital". It is ALWAYS shown when the app opens.
 *  - `auto` (the user already has a profile or a session): it holds for `hold` ms, fades out and calls `onStart`,
 *    so the Dashboard (or the sign-in screen) appears by itself.
 *  - otherwise (first run): the one "Iniciar" button (bottom third, thumb reach) starts the setup.
 * `timing` {hold:0, fade:0} skips the wait (tests).
 */
export default function SplashScreen({ onStart, auto = false, timing = SPLASH_TIMING }) {
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

  return (
    <main
      className={`mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 pb-40 text-center transition-opacity ease-out ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ transitionDuration: `${timing.fade}ms` }}
      data-testid="splash"
      data-leaving={leaving ? 'true' : undefined}
    >
      <Logo size={132} />
      <h1 className="sr-only">{t('app.name')}</h1>

      <div className="fixed inset-x-0 bottom-0 z-40 px-6 [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          {!auto && (
            <Button className="w-full" onClick={onStart} data-testid="splash-start">
              {t('splash.start')}
            </Button>
          )}
          <p className="mt-5 text-center text-xs text-neutral-500" data-testid="splash-credit">
            {t('splash.credit')}
          </p>
        </div>
      </div>
    </main>
  );
}
