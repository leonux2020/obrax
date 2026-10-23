import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { MAX_PHOTOS, PHOTO_SLOTS, PhotoError, compressImage, putPhoto, removePhoto, shouldUseLiveCamera } from '../lib/photos.js';
import { photoStoreFor } from '../lib/photoStore.js';
import CameraModal from './CameraModal.jsx';

const CameraIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
);

/**
 * Tap-to-Snap: an empty grid of photo tiles. Touching an empty tile opens the camera DIRECTLY (the phone's camera
 * app, or the in-app live camera on a desktop) and the photo is stored in that tile: compressed on the device,
 * saved locally, and printed in the reports. A filled tile only offers to remove its photo.
 */
export default function SnapGrid({ photos, setPhotos, projectId = '_' }) {
  const { t } = useI18n();
  const store = useMemo(() => photoStoreFor(projectId), [projectId]);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const pending = useRef(0);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(null);
  const liveCamera = useMemo(() => shouldUseLiveCamera(), []);

  const persist = async (slot, compressed) => {
    const saved = await store.save({ ...compressed, slot });
    setPhotos((prev) => putPhoto(prev, slot, saved));
  };
  const fail = (err) => setError(err instanceof PhotoError ? t(`photo.err.${err.code}`) : t('photo.err.store'));

  const snap = (slot) => {
    pending.current = slot;
    setError('');
    if (liveCamera) setLive(slot);
    else cameraRef.current?.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const slot = pending.current;
    if (!file || !(slot >= 0 && slot < MAX_PHOTOS)) return;
    setBusy(slot);
    try {
      await persist(slot, await compressImage(file));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onLiveCapture = async (photo) => {
    const slot = live;
    setLive(null);
    setBusy(slot);
    try {
      await persist(slot, photo);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slot) => {
    try {
      await store.remove(slot);
    } catch {
      /* the in-memory state is still cleared below */
    }
    setPhotos((prev) => removePhoto(prev, slot));
  };

  return (
    <section aria-label={t('snap.title')} data-testid="snap-grid">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="snap-input" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <ul className="grid grid-cols-2 gap-3">
        {PHOTO_SLOTS.map((key, slot) => {
          const photo = photos[slot];
          const label = t(`photo.slot.${key}`);
          const working = busy === slot;
          return (
            <li key={key} className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black">
              {photo ? (
                <>
                  <img src={photo.dataUrl} alt={label} width={photo.width} height={photo.height} decoding="async" draggable="false" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`${t('photo.delete')}: ${label}`}
                    data-testid={`snap-remove-${slot}`}
                    onClick={() => remove(slot)}
                    className="absolute right-1.5 top-1.5 flex h-10 w-10 items-center justify-center rounded-full border border-red-500 bg-black/80 text-red-400"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => snap(slot)}
                  data-testid={`snap-${slot}`}
                  aria-label={`${t('photo.addTo', { slot: label })}`}
                  className="flex h-full w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed border-white/15 text-neutral-400 transition hover:border-brand hover:text-brand active:bg-white/[0.04] disabled:opacity-60"
                >
                  {working ? (
                    <span className="text-sm font-semibold">{t('photo.processing')}</span>
                  ) : (
                    <>
                      <CameraIcon />
                      <span className="px-2 text-xs font-semibold">{label}</span>
                    </>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {store.kind === 'memory' && <p className="mt-2 text-xs text-neutral-400">{t('photo.memoryOnly')}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-400">
          {error}
        </p>
      )}
      {live !== null && (
        <CameraModal
          slotLabel={t(`photo.slot.${PHOTO_SLOTS[live]}`)}
          onCapture={onLiveCapture}
          onClose={() => setLive(null)}
          onUpload={() => {
            setLive(null);
            galleryRef.current?.click();
          }}
        />
      )}
    </section>
  );
}
