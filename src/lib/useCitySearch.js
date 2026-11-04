import { useEffect, useState } from 'react';
import { SEARCH_MIN_CHARS } from './forwardGeocode.js';

export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Autocomplete of the city field: waits for the typing to stop (`delay`, 400 ms), cancels the request of the previous text and answers the matches
 * of the CURRENT text only (a late answer of an older one is never shown). `search` null = off. Nothing here throws or blocks the form.
 */
export function useCitySearch(query, { search = null, lang = '', delay = SEARCH_DEBOUNCE_MS, min = SEARCH_MIN_CHARS } = {}) {
  const text = String(query || '').trim();
  const [state, setState] = useState({ q: '', places: [] });

  useEffect(() => {
    if (!search || text.length < min) {
      setState((s) => (s.places.length ? { q: '', places: [] } : s));
      return undefined;
    }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(async () => {
      let places = [];
      try {
        places = (await search(text, { lang, signal: ctl?.signal })) || [];
      } catch {
        places = [];
      }
      if (!ctl?.signal.aborted) setState({ q: text, places });
    }, delay);
    return () => {
      clearTimeout(timer);
      ctl?.abort();
    };
  }, [text, search, lang, delay, min]);

  return state.q === text ? state.places : [];
}
