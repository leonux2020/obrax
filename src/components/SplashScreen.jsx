import { useI18n } from '../lib/i18n.jsx';
import { Button, Logo } from './ui.jsx';

/**
 * Welcome screen: the logo, the app name and the entry buttons in the bottom third. It is ALWAYS the first
 * view for a new or signed-out user. A brand-new user gets the registration CTA ("Configurar mi Empresa")
 * plus a link for those who already have an account; a returning, signed-out user gets "Acceder".
 */
export default function SplashScreen({ onStart, onLogin = null, returning = false }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 pb-40 text-center" data-testid="splash">
      <Logo size={112} className="mb-6" />
      <h1 className="text-4xl font-extrabold tracking-tight">{t('app.name')}</h1>
      <p className="mt-2 text-neutral-300">{t('app.tagline')}</p>

      <div className="fixed inset-x-0 bottom-0 z-40 px-6 [padding-bottom:max(2rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-md">
          <Button className="w-full" onClick={onStart} data-testid="splash-start">
            {t(returning ? 'splash.enter' : 'setup.cta')}
          </Button>
          {onLogin && !returning && (
            <Button variant="ghost" className="mt-2 w-full" onClick={onLogin} data-testid="splash-login">
              {t('splash.login')}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
