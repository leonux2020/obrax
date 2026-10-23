import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getInstallState, promptInstall, startInstallCapture, subscribeInstall } from './installPrompt.js';

/** Service worker registration + install prompt + update flow + online status. */
export function usePWA() {
  const [waiting, setWaiting] = useState(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const refreshing = useRef(false);

  useEffect(() => {
    startInstallCapture(); // idempotent: main.jsx already did it before the first render
    const up = () => setOnline(true);
    const down = () => setOnline(false);
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
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      if (onControllerChange) navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  // the captured install event lives in installPrompt.js (it fires once, early); this only reads it
  const installSnapshot = useSyncExternalStore(subscribeInstall, () => JSON.stringify(getInstallState()), () => '{}');
  const { canPrompt, installed } = JSON.parse(installSnapshot || '{}');
  const install = useCallback(() => promptInstall(), []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    refreshing.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  return { canInstall: Boolean(canPrompt), installed: Boolean(installed), install, updateReady: Boolean(waiting), applyUpdate, online };
}
