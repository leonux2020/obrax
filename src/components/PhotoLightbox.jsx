import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n.jsx';
import { useBackLayer } from '../lib/backStack.js';

const CLOSE_SWIPE_PX = 90;

/**
 * Immersive full-screen viewer for the captured photos. `items` holds ONLY the photos that exist (`{ slot, photo, label }`): the empty tiles of
 * the grid are never part of it, so swiping goes straight from one photo to the next. The carousel is a native scroll-snap strip (the browser
 * does the swipe: momentum, rubber band, accessibility), with arrows and the arrow keys for a desktop.
 * There is no close button: it is a back-stack layer (the device's Back closes it), Escape closes it, and so does a swipe down or a tap on
 * the dark area around a photo.
 * It is drawn in a portal on <body>, so a bottom sheet's own swipe-to-close never hears these gestures.
 */
export default function PhotoLightbox({ items, start = 0, onClose }) {
  const { t } = useI18n();
  const strip = useRef(null);
  const root = useRef(null);
  const drag = useRef(null);
  const last = Math.max(0, items.length - 1);
  const [index, setIndex] = useState(Math.min(Math.max(0, start), last));
  useBackLayer(onClose);

  const goTo = (i) => {
    const el = strip.current;
    const next = Math.min(Math.max(0, i), last);
    setIndex(next);
    if (el) el.scrollTo?.({ left: next * el.clientWidth, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = index * el.clientWidth; // open straight on the tapped photo
    root.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!items.length) onClose(); // nothing left to show
  }, [items.length, onClose]);

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowRight') goTo(index + 1);
    else if (e.key === 'ArrowLeft') goTo(index - 1);
  };

  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    setIndex(Math.min(last, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  };

  const touch = {
    onTouchStart: (e) => {
      e.stopPropagation(); // React bubbles through portals: the sheet underneath must not start its own swipe
      drag.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    onTouchMove: (e) => e.stopPropagation(),
    onTouchCancel: (e) => {
      e.stopPropagation();
      drag.current = null;
    },
    onTouchEnd: (e) => {
      e.stopPropagation();
      const d = drag.current;
      drag.current = null;
      const p = e.changedTouches?.[0];
      if (!d || !p) return;
      const dy = p.clientY - d.y;
      if (dy > CLOSE_SWIPE_PX && dy > Math.abs(p.clientX - d.x) * 1.5) onClose(); // a clearly vertical, downward swipe
    },
  };

  const current = items[index];
  if (!current) return null;

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('photo.viewer')}
      tabIndex={-1}
      data-testid="photo-lightbox"
      data-index={index}
      onKeyDown={onKey}
      {...touch}
      onClick={(e) => e.stopPropagation()}
      className="no-print fixed inset-0 z-[60] flex flex-col bg-black outline-none"
    >
      <div className="flex min-h-[48px] items-center justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))] text-center text-sm text-neutral-300" aria-live="polite">
        <span className="truncate" data-testid="lightbox-caption">
          {current.label}
        </span>
        <span className="ml-3 shrink-0 tabular-nums text-neutral-400" data-testid="lightbox-counter">
          {index + 1} / {items.length}
        </span>
      </div>
      <div
        ref={strip}
        onScroll={onScroll}
        data-testid="lightbox-strip"
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ slot, photo, label }) => (
          <div
            key={slot}
            data-testid={`lightbox-slide-${slot}`}
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose(); // the dark area around the photo
            }}
            className="flex h-full w-full shrink-0 snap-center items-center justify-center p-2"
          >
            <img src={photo.dataUrl} alt={label} decoding="async" draggable="false" className="max-h-full max-w-full object-contain" />
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 justify-between px-2 sm:flex">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label={t('photo.prev')}
            data-testid="lightbox-prev"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/70 text-2xl text-neutral-200 disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={index === last}
            aria-label={t('photo.next')}
            data-testid="lightbox-next"
            className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/70 text-2xl text-neutral-200 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      )}
      <div className="h-[max(0.75rem,env(safe-area-inset-bottom))]" />
    </div>,
    document.body,
  );
}
