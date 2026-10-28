import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { useBackLayer } from '../../lib/backStack.js';
import { blobUrl, revokeBlobUrl } from '../../lib/notePhotos.js';

/** Object URL of a Blob for as long as the component lives (revoked afterwards): the picture is never turned into base64. */
export function useBlobUrl(blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = blob ? blobUrl(blob) : '';
    setUrl(next);
    return () => revokeBlobUrl(next);
  }, [blob]);
  return url;
}

/** The Blob of a note's photo, read from the store. */
export function useNotePhoto(store, noteId, enabled) {
  const [photo, setPhoto] = useState(null);
  useEffect(() => {
    let alive = true;
    setPhoto(null);
    if (enabled) {
      store
        .get(noteId)
        .then((p) => alive && setPhoto(p))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [store, noteId, enabled]);
  return photo;
}

/** Square thumbnail beside the note; a tap opens it full screen. Renders nothing while (or if) the picture is not there. */
export function NoteThumb({ photo, label, onOpen, size = 56, testId }) {
  const url = useBlobUrl(photo?.blob);
  if (!photo || !url) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      aria-label={label}
      data-testid={testId}
      style={{ width: size, height: size }}
      className="shrink-0 overflow-hidden rounded-lg border border-white/15 bg-black active:border-white/50"
    >
      <img src={url} alt="" width={photo.width} height={photo.height} decoding="async" draggable="false" className="h-full w-full object-cover" />
    </button>
  );
}

/** Simple full-screen viewer (OLED black). Tap anywhere, the ✕ or Escape to close. */
export function PhotoLightbox({ url, onClose }) {
  const { t } = useI18n();
  useBackLayer(onClose); // the device's Back closes the viewer only
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={t('ws.log.photo')} data-testid="photo-lightbox" className="fixed inset-0 z-[60] flex items-center justify-center bg-black" onClick={onClose}>
      <img src={url} alt={t('ws.log.photo')} data-testid="photo-lightbox-img" className="max-h-full max-w-full object-contain" />
      <button type="button" onClick={onClose} aria-label={t('common.close')} data-testid="photo-lightbox-close" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black text-lg text-[#E0E0E0] [margin-top:env(safe-area-inset-top)]">
        ✕
      </button>
    </div>
  );
}
