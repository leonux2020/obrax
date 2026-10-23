import { useSyncExternalStore } from 'react';
import { aiAccess, isPro, subscribePro } from './pro.js';

/** Reactive PRO flag: every component using it re-renders the moment the plan changes. */
export const usePro = () => useSyncExternalStore(subscribePro, isPro, () => false);

/** Reactive AI access: 'pro' | 'dev' (localhost bypass) | null. Truthy = the AI scanner / invoice reading may open. */
export const useAiAccess = () => useSyncExternalStore(subscribePro, aiAccess, () => null);
