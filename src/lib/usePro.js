import { useSyncExternalStore } from 'react';
import { isPro, subscribePro } from './pro.js';

/** Reactive PRO flag: every component using it re-renders the moment the plan changes. */
export const usePro = () => useSyncExternalStore(subscribePro, isPro, () => false);
