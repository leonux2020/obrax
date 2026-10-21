import { useCallback, useEffect, useRef, useState } from 'react';

/** Service worker registration + install prompt + update flow + online status. */
export function usePWA() {
  const [installEvent, setInstallEvent] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const refreshing = useRef(false);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => setInstallEvent(null);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);

    let onControllerChange;
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      onControllerChange = () => {
        if (refreshing.current) window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw?.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw);
            });
          });
          // check for updates whenever the app returns to the foreground
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
          });
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      if (onControllerChange) navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      await installEvent.userChoice;
    } finally {
      setInstallEvent(null);
    }
  }, [installEvent]);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    refreshing.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  return { canInstall: Boolean(installEvent), install, updateReady: Boolean(waiting), applyUpdate, online };
}
