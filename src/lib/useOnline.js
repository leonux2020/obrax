import { useSyncExternalStore } from 'react';

const subscribe = (fn) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};

/** true while the browser believes it has a connection (a hint, not a guarantee: requests can still fail). */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine !== false, () => true);
