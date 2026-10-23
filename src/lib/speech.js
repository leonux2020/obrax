// Voice dictation for the logbook (Web Speech API). Chrome/Edge/Safari expose it as `SpeechRecognition` or
// `webkitSpeechRecognition`; Firefox has none. PRIVACY NOTE: in Chrome the audio is sent to the browser vendor's
// speech service for recognition; this app never receives, stores or uploads the audio, only the resulting text.

const LOCALES = { es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', it: 'it-IT', de: 'de-DE' };

export const speechLocale = (lang, regionLocale = '') => (/^[a-z]{2}-[A-Z]{2}$/.test(regionLocale) && regionLocale.slice(0, 2) === lang ? regionLocale : LOCALES[lang] || 'es-ES');

/** The browser's recognition constructor, or null when the browser has none. */
export function getSpeechRecognition(win = typeof window === 'undefined' ? null : window) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

/** Joins the text already in the field with what has just been dictated (single space, no double blanks). */
export const joinSpeech = (base, spoken) => [base, spoken].map((s) => (s || '').trim()).filter(Boolean).join(' ');

const ERRORS = { 'not-allowed': 'denied', 'service-not-allowed': 'denied', 'audio-capture': 'denied' };

/**
 * One dictation session.
 *  - onText(fullText)  live transcript (base text + final results + the interim words still being recognised)
 *  - onEnd(fullText)   the session finished (stop tapped, silence timeout, or error): the caller saves it
 *  - onError(kind)     'denied' | 'unsupported' | 'error'   ('no-speech' / 'aborted' are NOT errors)
 * Returns { start, stop, supported }.
 */
export function createDictation({ lang = 'es', locale = '', getBase = () => '', onText, onEnd, onError, win } = {}) {
  const Ctor = getSpeechRecognition(win);
  let rec = null;
  let finals = '';
  let base = '';
  let latest = '';
  let active = false;
  let ended = true;

  const finish = () => {
    if (ended) return;
    ended = true;
    active = false;
    rec = null;
    onEnd?.(latest);
  };

  const start = () => {
    if (!Ctor) {
      onError?.('unsupported');
      return false;
    }
    if (active) return true;
    base = getBase() || '';
    finals = '';
    latest = base;
    ended = false;
    try {
      rec = new Ctor();
      rec.lang = speechLocale(lang, locale);
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex ?? 0; i < ev.results.length; i += 1) {
          const r = ev.results[i];
          const piece = r[0]?.transcript || '';
          if (r.isFinal) finals = joinSpeech(finals, piece);
          else interim = joinSpeech(interim, piece);
        }
        latest = joinSpeech(base, joinSpeech(finals, interim));
        onText?.(latest);
      };
      rec.onerror = (ev) => {
        const code = ev?.error || '';
        if (code === 'no-speech' || code === 'aborted') return; // silence / our own stop: onend follows
        onError?.(ERRORS[code] || 'error');
      };
      rec.onend = finish;
      active = true;
      rec.start();
      return true;
    } catch {
      active = false;
      ended = true;
      rec = null;
      onError?.('error');
      return false;
    }
  };

  const stop = () => {
    if (!rec) return;
    try {
      rec.stop(); // the final results still arrive, then onend
    } catch {
      finish();
    }
  };

  return { start, stop, supported: Boolean(Ctor), isActive: () => active };
}
