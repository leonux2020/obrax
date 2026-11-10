import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { PHOTO_CAPTION_MAX } from '../lib/photos.js';
import { sanitizeText } from '../lib/sanitize.js';
import { useDictation } from '../lib/useDictation.js';
import BottomSheet from './BottomSheet.jsx';
import { Button } from './ui.jsx';

export const MicIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="mic">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </svg>
);

/**
 * The caption of a field photo, "zero-stress": a light drop-up over the photo's thumbnail with a two-line field, a BIG microphone (the very same dictation
 * engine as the logbook: useDictation -> createDictation) and ONE button. Photo-first: when it opens after a capture the picture is ALREADY saved, so leaving
 * (the button, Back, a swipe down, the backdrop) never loses anything: "Guardar sin texto" is a one-tap exit, well under a second.
 * The same sheet edits the caption later (`initial`): saving an empty text removes the caption.
 * @param photo    { dataUrl }  the thumbnail
 * @param label    the name of the slot ("Panorámica")
 * @param onSave   (text) => void  the cleaned text ('' = none)
 */
export default function PhotoCaptionSheet({ photo, label = '', initial = '', onSave, onClose }) {
  const { t, lang, locale } = useI18n();
  const [text, setText] = useState(() => sanitizeText(initial, PHOTO_CAPTION_MAX));
  const textRef = useRef(text);
  textRef.current = text;
  const mic = useDictation({
    lang,
    locale,
    getText: () => textRef.current,
    onText: (full) => setText(sanitizeText(full, PHOTO_CAPTION_MAX)),
  });
  const micIssue = mic.issue ? { denied: 'log.dictateDenied', unsupported: 'log.dictateUnsupported', network: 'log.dictateNetwork' }[mic.issue] || 'log.dictateError' : '';
  const clean = text.trim();
  const save = () => {
    if (mic.listening) return; // the microphone is stopped first (its own button): what is being said still lands in the field
    onSave(clean);
  };
  const actionLabel = clean ? t('photo.caption.save') : initial.trim() ? t('photo.caption.clear') : t('photo.caption.skip');

  return (
    <BottomSheet title={t('photo.caption.title')} subtitle={label} onClose={onClose} dock autoFocus={false}>
      <div className="mt-3 space-y-4" data-testid="photo-caption">
        {photo?.dataUrl && <img src={photo.dataUrl} alt={label} width={96} height={72} decoding="async" draggable="false" data-testid="photo-caption-thumb" className="h-[72px] w-24 rounded-xl object-cover" />}
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(sanitizeText(e.target.value, PHOTO_CAPTION_MAX))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // two lines at most, no essays: Enter = done
                save();
              }
            }}
            readOnly={mic.listening}
            rows={2}
            maxLength={PHOTO_CAPTION_MAX}
            lang={lang}
            placeholder={t('photo.caption.ph')}
            aria-label={t('photo.caption.ph')}
            autoCapitalize="sentences"
            enterKeyHint="done"
            spellCheck
            data-testid="photo-caption-input"
            className="field-input min-h-[88px] resize-none pr-[4.5rem]"
          />
          <button
            type="button"
            onClick={mic.toggle}
            aria-label={mic.listening ? t('log.dictate.stop') : t('log.dictate')}
            aria-pressed={mic.listening}
            data-testid="photo-caption-mic"
            data-listening={mic.listening ? 'true' : 'false'}
            className={`absolute right-2 top-1/2 flex h-14 w-14 -translate-y-1/2 select-none items-center justify-center rounded-full transition active:scale-95 active:opacity-70 ${
              mic.listening ? 'animate-pulse bg-red-400/20 text-red-400/90' : 'bg-white/5 text-neutral-200'
            }`}
          >
            <MicIcon />
          </button>
        </div>
        {mic.listening && (
          <p role="status" className="flex items-center gap-2 text-xs font-light text-red-400/90" data-testid="photo-caption-listening">
            <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400/90" />
            {t('log.listening')}
          </p>
        )}
        {micIssue && (
          <p role="alert" className="text-sm font-light text-red-400/90" data-testid="photo-caption-issue">
            {t(micIssue)}
          </p>
        )}
        <Button onClick={save} disabled={mic.listening} data-testid="photo-caption-save" className="w-full">
          {actionLabel}
        </Button>
      </div>
    </BottomSheet>
  );
}
