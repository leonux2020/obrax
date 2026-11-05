import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { drawStroke, hasInk, smoothPoint, SMOOTHING } from '../lib/signature.js';

const MIN_STEP = SMOOTHING.minStep; // px: points closer than this are dropped (keeps strokes light and smooth)

/**
 * Touch / pen / mouse signature canvas. Strokes are kept as points (CSS px) and repainted whenever the
 * canvas is resized, so rotating the phone or opening the keyboard never wipes the signature.
 * On screen the ink is white on pure black (OLED); the exported PNG uses black ink (see lib/signature.js).
 * `locked`: the pad ignores every touch (and lets the page scroll under the finger) until it is unlocked; only an unlocked pad is `touch-none`.
 * Imperative API: clear(), getStrokes(), hasInk().
 */
const SignaturePad = forwardRef(function SignaturePad({ label, placeholder, onInkChange, className = '', locked = false }, ref) {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const canvasRef = useRef(null);
  const strokes = useRef([]);
  const current = useRef(null);
  const [inked, setInked] = useState(false);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const dpr = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.strokeStyle = '#ffffff';
    for (const s of strokes.current) drawStroke(ctx, s);
  }, []);

  // keep the bitmap in sync with the CSS size (and the device pixel ratio)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const fit = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      paint();
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [paint]);

  // `touch-none` (touch-action: none) already stops the page from scrolling under the finger; this non-passive listener also covers
  // browsers that ignore it, so the page never scrolls, bounces or pull-to-refreshes while the signature is being drawn.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const stop = (e) => !lockedRef.current && e.cancelable && e.preventDefault();
    canvas.addEventListener('touchstart', stop, { passive: false });
    canvas.addEventListener('touchmove', stop, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', stop);
      canvas.removeEventListener('touchmove', stop);
    };
  }, []);

  const setInk = (value) => {
    setInked(value);
    onInkChange?.(value);
  };

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        strokes.current = [];
        current.current = null;
        paint();
        setInk(false);
      },
      getStrokes: () => strokes.current,
      hasInk: () => hasInk(strokes.current),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paint]
  );

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e) => {
    if (lockedRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      canvasRef.current.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone: drawing still works through the canvas events */
    }
    current.current = [point(e)];
    strokes.current.push(current.current);
    paint();
    if (!inked) setInk(true);
  };

  const onMove = (e) => {
    const stroke = current.current;
    if (!stroke) return;
    e.preventDefault();
    // coalesced events give a smoother line on fast finger / pen movement
    const events = e.nativeEvent?.getCoalescedEvents?.() || [];
    for (const ev of events.length ? events : [e]) {
      const last = stroke[stroke.length - 1];
      const p = smoothPoint(last, point(ev)); // damped: hand tremor never becomes a corner of the line
      if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) stroke.push(p);
    }
    paint();
  };

  const onUp = (e) => {
    if (!current.current) return;
    try {
      canvasRef.current.releasePointerCapture?.(e.pointerId);
    } catch {
      /* nothing captured */
    }
    // the filter lags a little behind the finger: close the stroke exactly where it was lifted
    const stroke = current.current;
    const end = point(e);
    const last = stroke[stroke.length - 1];
    if (Number.isFinite(end.x) && Number.isFinite(end.y) && Math.hypot(end.x - last.x, end.y - last.y) >= 0.5 && stroke.length > 1) stroke.push(end);
    current.current = null;
    paint();
  };

  return (
    <div className={`relative h-44 w-full overflow-hidden rounded-xl border border-white/10 bg-black sm:h-52 ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        data-testid="signature-canvas"
        className={`absolute inset-0 h-full w-full select-none ${locked ? 'pointer-events-none' : 'cursor-crosshair touch-none'}`}
        data-locked={locked ? 'true' : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {/* guide line + hint, both ignored by pointer events */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-10 border-t border-white/10" />
      {!inked && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold text-neutral-500">
          {placeholder}
        </span>
      )}
    </div>
  );
});

export default SignaturePad;
