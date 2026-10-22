import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import {
  MAX_PHOTOS,
  PHOTO_SLOTS,
  PhotoError,
  compressImage,
  countPhotos,
  putPhoto,
  removePhoto,
  shouldUseLiveCamera,
} from '../lib/photos.js';
import { photoStoreFor } from '../lib/photoStore.js';
import CameraModal from './CameraModal.jsx';

/**
 * Field photo evidence: exactly MAX_PHOTOS named slots, camera or gallery, compressed on the device
 * and persisted locally (IndexedDB). Replacing a photo reuses its slot, so the limit can never be exceeded.
 */
export default function PhotoGallery({ photos, setPhotos, projectId = '_' }) {
  const { t } = useI18n();
  const photoStore = useMemo(() => photoStoreFor(projectId), [projectId]); // photos belong to ONE project
  const cameraRef = useRef(null); // mobile: native camera via capture="environment"
  const galleryRef = useRef(null); // file picker (also the fallback when the live camera is unavailable)
  const pending = useRef(0);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(null); // slot index while the in-app camera modal is open

  // Mobile keeps the OS camera app; desktop with getUserMedia gets the in-app live camera.
  const liveCamera = useMemo(() => shouldUseLiveCamera(), []);

  const persist = async (slot, compressed) => {
    const saved = await photoStore.save({ ...compressed, slot });
    setPhotos((prev) => putPhoto(prev, slot, saved));
  };

  const fail = (err) => setError(err instanceof PhotoError ? t(`photo.err.${err.code}`) : t('photo.err.store'));

  const pick = (slot, source) => {
    pending.current = slot;
    setError('');
    if (source === 'camera' && liveCamera) setLive(slot);
    else (source === 'camera' ? cameraRef : galleryRef).current?.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
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

  // Fallback from the modal: close it and open the plain file picker (fresh user gesture = allowed).
  const uploadInstead = () => {
    setLive(null);
    galleryRef.current?.click();
  };

  const remove = async (slot) => {
    try {
      await photoStore.remove(slot);
    } catch {
      /* the in-memory state is still cleared below */
    }
    setPhotos((prev) => removePhoto(prev, slot));
  };

  return (
    <section aria-labelledby="photo-title" className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="photo-title" className="text-lg font-bold">
          {t('photo.title')}
        </h3>
        <span className="text-sm font-semibold text-brand" aria-live="polite">
          {t('photo.count', { n: countPhotos(photos), max: MAX_PHOTOS })}
        </span>
      </div>
      <p className="text-sm text-neutral-300">{t('photo.hint', { max: MAX_PHOTOS })}</p>
      {photoStore.kind === 'memory' && <p className="text-xs text-neutral-400">{t('photo.memoryOnly')}</p>}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />

      <ul className="grid grid-cols-2 gap-3">
        {PHOTO_SLOTS.map((key, slot) => {
          const photo = photos[slot];
          const label = t(`photo.slot.${key}`);
          const working = busy === slot;
          return (
            <li key={key} className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
              <div className="relative flex aspect-[4/3] items-center justify-center bg-black">
                {photo ? (
                  <img
                    src={photo.dataUrl}
                    alt={label}
                    width={photo.width}
                    height={photo.height}
                    decoding="async"
                    className="h-full w-full bg-black object-cover"
                    draggable="false"
                  />
                ) : (
                  <span className="px-2 text-center text-sm text-neutral-500">{working ? t('photo.processing') : t('photo.empty')}</span>
                )}
                {photo && working && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm font-semibold">
                    {t('photo.processing')}
                  </span>
                )}
                {photo && (
                  <button
                    type="button"
                    aria-label={`${t('photo.delete')}: ${label}`}
                    onClick={() => remove(slot)}
                    className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full border border-red-500 bg-black/80 text-red-400"
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="truncate px-2 pt-1.5 text-sm font-bold">{label}</p>
              <div className="grid grid-cols-2 gap-1.5 p-2">
                {['camera', 'gallery'].map((source) => (
                  <button
                    key={source}
                    type="button"
                    disabled={working}
                    aria-label={`${t(photo ? 'photo.replaceWith' : 'photo.addTo', { slot: label })} (${t(`photo.${source}`)})`}
                    onClick={() => pick(slot, source)}
                    className="min-h-[44px] rounded-lg border border-neutral-700 px-1 text-sm font-semibold hover:border-brand disabled:opacity-40"
                  >
                    <span aria-hidden="true">{source === 'camera' ? '📷 ' : '🖼 '}</span>
                    {t(`photo.${source}`)}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm font-semibold text-red-400">
          {error}
        </p>
      )}
      {live !== null && (
        <CameraModal
          slotLabel={t(`photo.slot.${PHOTO_SLOTS[live]}`)}
          onCapture={onLiveCapture}
          onClose={() => setLive(null)}
          onUpload={uploadInstead}
        />
      )}
    </section>
  );
}
