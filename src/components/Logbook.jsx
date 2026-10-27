import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { LEDGER_LIMITS, newEntryId } from '../lib/ledger.js';
import { sanitizeText } from '../lib/sanitize.js';
import { createDictation, getSpeechRecognition } from '../lib/speech.js';
import { PhotoError } from '../lib/photos.js';
import { prepareNotePhoto } from '../lib/notePhotos.js';
import { Button } from './ui.jsx';
import { NoteThumb, PhotoLightbox } from './workspace/NotePhoto.jsx';

const Icon = ({ children, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/**
 * Bitácora con dictado por voz (Web Speech API): the microphone icon starts/stops the dictation, the words appear in the
 * text area WHILE you speak and, when the dictation ends, the note is saved by itself into the project (IndexedDB, through
 * the usual persistence of the open project). Typing and the "Guardar nota" button keep working.
 * `showList={false}`: only the capture part (the workspace shows the notes in its own accordion); `onSaved` runs after a note
 * has been added. `photoStore` (notePhotos.js) turns on the 📸 button: the photo is kept as a Blob in IndexedDB under the new note.
 */
export default function Logbook({ entries, onChange, showList = true, onSaved, photoStore = null }) {
  const { t, lang, locale } = useI18n();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState(''); // i18n key of the status line
  const field = useRef(null);
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null); // { blob, width, height } waiting for the note it will belong to
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [viewer, setViewer] = useState('');
  const photoRef = useRef(null);
  photoRef.current = photo;
  const dictation = useRef(null);
  // refs so the speech callbacks (created once per session) always see the latest values
  const textRef = useRef('');
  const entriesRef = useRef(entries);
  const changeRef = useRef(onChange);
  const savedRef = useRef(onSaved);
  entriesRef.current = entries;
  changeRef.current = onChange;
  savedRef.current = onSaved;
  textRef.current = text;

  const commit = (raw, { photoOnly = false } = {}) => {
    const clean = sanitizeText(raw, LEDGER_LIMITS.logChars).trim();
    const attached = photoStore ? photoRef.current : null;
    if (!clean && !(photoOnly && attached)) return false;
    const id = newEntryId();
    if (attached) {
      photoStore.put(id, attached).catch(() => {}); // Blob -> IndexedDB (never base64 / localStorage)
    }
    const entry = { id, at: Date.now(), text: clean || t('ws.log.photoOnly'), ...(attached ? { photo: true } : {}) };
    changeRef.current([entry, ...entriesRef.current].slice(0, LEDGER_LIMITS.logbook));
    setText('');
    textRef.current = '';
    setPhoto(null);
    photoRef.current = null;
    savedRef.current?.();
    return true;
  };
  const save = () => {
    setNote('');
    commit(text, { photoOnly: true });
  };
  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setPhotoBusy(true);
    try {
      setPhoto(await prepareNotePhoto(file));
    } catch (err) {
      setPhotoError(err instanceof PhotoError ? `photo.err.${err.code}` : 'photo.err.store');
    } finally {
      setPhotoBusy(false);
    }
  };
  const supported = Boolean(getSpeechRecognition());
  const micIssue = ['log.dictateDenied', 'log.dictateUnsupported', 'log.dictateNetwork', 'log.dictateError'].includes(note); // shown as a visible red notice

  const toggleMic = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    if (!supported) {
      field.current?.focus();
      setNote('log.dictateUnsupported');
      return;
    }
    setNote('log.listening');
    dictation.current = createDictation({
      lang,
      locale,
      getBase: () => textRef.current,
      onText: (full) => setText(sanitizeText(full, LEDGER_LIMITS.logChars)),
      onActive: () => setNote('log.listening'), // the microphone is really open
      onEnd: (full) => {
        setListening(false);
        setNote(commit(full) ? 'log.autosaved' : ''); // end of the dictation = saved into the project
      },
      onError: (kind) => {
        setListening(false);
        setNote(
          kind === 'denied' ? 'log.dictateDenied' : kind === 'unsupported' ? 'log.dictateUnsupported' : kind === 'network' ? 'log.dictateNetwork' : 'log.dictateError',
        );
      },
    });
    if (dictation.current.start()) setListening(true);
  };
  // leaving the screen while dictating: close the session (its onEnd still saves what was said)
  useEffect(() => () => dictation.current?.stop(), []);

  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');
  return (
    <div className="space-y-3">
      {showList && entries.length > 0 && (
        <ul className="space-y-2" data-testid="log-list">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-white/10 px-4 py-3">
              <p className="text-xs font-semibold text-neutral-400">{stamp(e.at)}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{e.text}</p>
              <button
                type="button"
                onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
                aria-label={`${t('common.delete')}: ${stamp(e.at)}`}
                className="mt-1 min-h-[36px] text-xs font-bold text-neutral-500 hover:text-red-400"
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <textarea
          ref={field}
          value={text}
          onChange={(e) => setText(sanitizeText(e.target.value, LEDGER_LIMITS.logChars))}
          rows={3}
          lang={lang}
          inputMode="text"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          enterKeyHint="done"
          placeholder={t('log.placeholder')}
          aria-label={t('log.title')}
          data-testid="log-input"
          className="field-input min-h-[96px] resize-y pr-14"
        />
        <button
          type="button"
          onClick={toggleMic}
          aria-label={listening ? t('log.dictate.stop') : t('log.dictate')}
          aria-pressed={listening}
          data-testid="log-mic"
          data-listening={listening ? 'true' : 'false'}
          className={`absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 ${
            listening ? 'animate-pulse border-red-500 bg-red-500 text-white shadow-[0_0_16px_rgba(239,68,68,0.7)]' : 'border-white/15 text-brand hover:border-brand'
          }`}
        >
          {/* the microphone itself turns red and blinks while it listens; tap again to stop */}
          <Icon size={22}>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </Icon>
        </button>
      </div>
      {photoStore && (
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="log-photo-input" onChange={onPickPhoto} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            data-testid="log-photo"
            className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-bold text-[#E0E0E0] active:border-white/50 disabled:opacity-60"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              📸
            </span>
            {photoBusy ? t('ws.log.photoBusy') : photo ? t('ws.log.photoChange') : t('ws.log.photoAdd')}
          </button>
          {photo && (
            <>
              <NoteThumb photo={photo} label={t('ws.log.photoOpen')} onOpen={setViewer} testId="log-photo-thumb" />
              <button type="button" onClick={() => setPhoto(null)} aria-label={t('ws.log.photoRemove')} data-testid="log-photo-remove" className="flex h-11 w-11 items-center justify-center text-[#E0E0E0]/60 active:text-red-400">
                ✕
              </button>
            </>
          )}
        </div>
      )}
      {photoError && (
        <p role="alert" className="text-sm font-semibold text-red-400" data-testid="log-photo-error">
          {t(photoError)}
        </p>
      )}
      {viewer && <PhotoLightbox url={viewer} onClose={() => setViewer('')} />}
      {note && (
        <p
          role={micIssue ? 'alert' : 'status'}
          data-testid="log-mic-hint"
          data-kind={listening ? 'listening' : micIssue ? 'error' : 'info'}
          className={
            listening
              ? 'flex items-center gap-2 text-xs font-semibold text-red-400'
              : micIssue
                ? 'rounded-xl border border-red-500/60 px-3 py-2 text-sm font-semibold text-red-400'
                : 'text-xs text-neutral-300'
          }
        >
          {listening && <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />}
          {t(note)}
        </p>
      )}
      {(text.trim() || photo) && !listening && (
        <Button className="w-full" onClick={save} data-testid="log-save">
          {t('log.save')}
        </Button>
      )}
    </div>
  );
}
