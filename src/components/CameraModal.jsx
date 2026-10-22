import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { PhotoError, compressVideoFrame } from '../lib/photos.js';

/**
 * In-app live camera (desktop). Streams getUserMedia into a <video>, and "Disparar" feeds the current
 * frame through the SAME canvas compressor used for files. Any failure (permission denied, no device,
 * insecure origin) shows a message and offers a clean fallback to a normal file upload.
 */
export default function CameraModal({ slotLabel, onCapture, onClose, onUpload, getStream }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const dialogRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | live | denied
  const [shooting, setShooting] = useState(false);
  const [error, setError] = useState('');

  const stop = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    const open =
      getStream ||
      (() =>
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        }));
    (async () => {
      try {
        const stream = await open();
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play?.().catch(() => {});
        if (!cancelled) setState('live');
      } catch {
        if (!cancelled) setState('denied');
      }
    })();
    dialogRef.current?.focus();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shoot = async () => {
    if (shooting || state !== 'live') return;
    setShooting(true);
    setError('');
    try {
      const photo = compressVideoFrame(videoRef.current);
      stop();
      await onCapture(photo);
    } catch (err) {
      setError(err instanceof PhotoError ? t(`photo.err.${err.code}`) : t('photo.err.store'));
      setShooting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cam-title"
        tabIndex={-1}
        data-testid="camera-modal"
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 rounded-2xl border border-neutral-700 bg-black p-4 outline-none"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="cam-title" className="text-lg font-bold">
            {t('photo.cameraTitle')}
          </h2>
          <span className="truncate text-sm text-brand">{t('photo.cameraFor', { slot: slotLabel })}</span>
        </div>

        {state !== 'denied' ? (
          <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-contain" data-testid="camera-video" />
            {state === 'starting' && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300" aria-live="polite">
                {t('photo.cameraStarting')}
              </p>
            )}
          </div>
        ) : (
          <div role="alert" className="rounded-xl border border-red-500/60 bg-black p-4 text-sm font-semibold text-red-300">
            {t('photo.cameraDenied')}
          </div>
        )}

        {state === 'live' && <p className="text-sm text-neutral-300">{t('photo.cameraHint')}</p>}
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-xl border border-neutral-700 px-5 font-bold hover:border-white/40">
            {t('common.close')}
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="min-h-[52px] rounded-xl border-2 border-brand px-5 font-bold text-brand hover:bg-brand/10"
          >
            {t('photo.upload')}
          </button>
          {state !== 'denied' && (
            <button
              type="button"
              onClick={shoot}
              disabled={state !== 'live' || shooting}
              data-testid="camera-shoot"
              className="min-h-[52px] flex-1 rounded-xl bg-brand px-5 font-bold text-black disabled:opacity-40"
            >
              {t('photo.shoot')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
