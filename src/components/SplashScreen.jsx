import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo } from './ui.jsx';

/**
 * Welcome screen: ONLY the logo, one "Iniciar" button (bottom third, thumb reach) and "Un producto Japadigital".
 * It is always the first view of a new or signed-out user.
 */
export default function SplashScreen({ onStart }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 pb-40 text-center" data-testid="splash">
      <Logo size={132} />
      <h1 className="sr-only">{t('app.name')}</h1>

      <div className="fixed inset-x-0 bottom-0 z-40 px-6 [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          <Button className="w-full" onClick={onStart} data-testid="splash-start">
            {t('splash.start')}
          </Button>
          <p className="mt-5 text-center text-xs text-neutral-500" data-testid="splash-credit">
            {t('splash.credit')}
          </p>
        </div>
      </div>
    </main>
  );
}
