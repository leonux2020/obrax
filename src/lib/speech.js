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

const ERRORS = { 'not-allowed': 'denied', 'service-not-allowed': 'denied', 'audio-capture': 'denied', network: 'network' };

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Joins the FINAL fragments of a session in order. Some mobile engines (Android Chrome) send every final result as the
 * CUMULATIVE text so far ("traer" / "traer la" / "traer la comida"): a fragment that merely extends what we already have
 * REPLACES it instead of being appended (otherwise: "traer traer la traer la comida").
 */
export function mergeFinals(fragments) {
  let out = '';
  for (const raw of fragments) {
    const piece = (raw || '').trim();
    if (!piece) continue;
    const a = norm(out);
    const p = norm(piece);
    out = a && p.length >= a.length && p.startsWith(a) ? piece : joinSpeech(out, piece);
  }
  return out;
}

/** A dictated note ends in a full stop (unless it already ends in punctuation) so the next one never sticks to it. */
export const closeSentence = (text) => {
  const t = (text || '').trim();
  return t && !/[.!?…:;,]$/.test(t) ? `${t}.` : t;
};

// Only ONE recognizer may listen at a time: a new session silences any older one (handlers detached, no callbacks).
let live = null;
const detach = (r) => {
  r.onresult = null;
  r.onerror = null;
  r.onend = null;
  r.onaudiostart = null;
};
const silence = (r) => {
  if (!r) return;
  detach(r);
  try {
    r.abort?.();
  } catch {
    /* already closed */
  }
};

/**
 * One dictation session.
 *  - onText(fullText)  transcript so far (base text + the FINAL fragments; no interim words)
 *  - onEnd(fullText)   the session finished (stop tapped, silence timeout, or error): the caller saves it
 *  - onError(kind)     'denied' | 'network' | 'unsupported' | 'error'   ('no-speech' / 'aborted' are NOT errors)
 *  - onActive()        the microphone is really open (audio capture started): the UI can show "listening"
 * Returns { start, stop, supported }.
 */
export function createDictation({ lang = 'es', locale = '', getBase = () => '', onText, onEnd, onError, onActive, win } = {}) {
  const Ctor = getSpeechRecognition(win);
  let rec = null;
  const finals = new Map(); // final fragments of THIS session by result index (a re-sent result overwrites, never appends)
  let base = '';
  let latest = '';
  let active = false;
  let ended = true;

  const finish = () => {
    if (ended) return;
    ended = true;
    active = false;
    if (rec) {
      detach(rec); // no listener survives the session
      if (live === rec) live = null;
    }
    rec = null;
    if (latest !== base) latest = closeSentence(latest);
    onEnd?.(latest);
  };

  const start = () => {
    if (!Ctor) {
      onError?.('unsupported');
      return false;
    }
    if (active) return true;
    base = getBase() || '';
    finals.clear();
    latest = base;
    ended = false;
    try {
      silence(live);
      rec = new Ctor();
      live = rec;
      rec.lang = speechLocale(lang, locale);
      rec.continuous = false; // one phrase per session: the engine waits for the natural pause and returns it complete
      rec.interimResults = false; // no stuttering partial text in a noisy site
      rec.maxAlternatives = 1;
      rec.onaudiostart = () => onActive?.();
      rec.onresult = (ev) => {
        // Only the results that are new in this event (from resultIndex), and only the FINAL ones: interim text is never
        // part of the persistent state.
        const list = ev.results || [];
        for (let i = ev.resultIndex || 0; i < list.length; i += 1) {
          const r = list[i];
          const piece = r?.[0]?.transcript || '';
          if (r?.isFinal && piece.trim()) finals.set(i, piece);
        }
        const spoken = mergeFinals([...finals.keys()].sort((x, y) => x - y).map((k) => finals.get(k)));
        latest = joinSpeech(base, spoken);
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
      rec.stop(); // the final result still arrives, then onend
    } catch {
      finish();
    }
  };

  return { start, stop, supported: Boolean(Ctor), isActive: () => active };
}
