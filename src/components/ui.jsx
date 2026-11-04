import { useId, useState } from 'react';
import { LETTER_PATHS, MARK_LAYOUT, IMAGO_LAYOUT, ICON_LAYOUT, IMAGO_INK, DIM_ART, RULER_ART, HELMET_FILE, WORD, WORD_BOX, WORD_VIEWBOX, BRAND } from '../brand/icon.js';
import NumberPad from './workspace/NumberPad.jsx';
import { usePro } from '../lib/usePro.js';

/** Titanium / silver hard hat of a PRO user: the photo goes grey and a bit brighter and crisper. The green X of the lettering is never touched. */
export const TITANIUM_HELMET = 'grayscale brightness-125 contrast-125';

/**
 * The complete CUBRAX imagotype: isotype + lettering in ONE SVG (viewBox = the whole lockup, nothing is cut or squeezed).
 *   stacked    (welcome) the lettering is centred EXACTLY under the hard hat and the ruler (the same lockup as the app icon)
 *   imagotype  the lettering on the right of the hat (wide rectangle)
 * "CUBRA" light grey (#e5e5e5), only the "X" brand green (#22c55e). `titanium` (PRO) filters ONLY the hard hat photo. Size it with classes (`w-56 h-auto`).
 */
function Imagotype({ className = '', stacked = false, titanium = false }) {
  const ink = (art) => art.replaceAll('#ffffff', IMAGO_INK);
  const box = stacked ? { w: ICON_LAYOUT.w, h: ICON_LAYOUT.h } : IMAGO_LAYOUT;
  const markX = stacked ? ICON_LAYOUT.markX : 0;
  const word = stacked ? { x: 0, y: ICON_LAYOUT.wordTop, w: ICON_LAYOUT.wordW, h: ICON_LAYOUT.wordH } : IMAGO_LAYOUT.word;
  return (
    <svg viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label="CUBRAX" focusable="false" className={`block max-w-full select-none ${className}`} data-testid="logo" data-variant={stacked ? 'stacked' : 'imagotype'}>
      <g transform={`translate(${markX} 0)`}>
        <g dangerouslySetInnerHTML={{ __html: ink(DIM_ART) }} />
        <image
          href={`${import.meta.env.BASE_URL}${HELMET_FILE}`}
          data-testid="logo-helmet"
          data-titanium={titanium ? 'true' : undefined}
          className={titanium ? TITANIUM_HELMET : undefined}
          x="0"
          y={MARK_LAYOUT.helmet.y}
          width={MARK_LAYOUT.w}
          height={MARK_LAYOUT.helmet.h}
          preserveAspectRatio="xMidYMid meet"
        />
        <g dangerouslySetInnerHTML={{ __html: ink(RULER_ART) }} />
      </g>
      <svg x={word.x} y={word.y} width={word.w} height={word.h} viewBox={WORD_VIEWBOX} data-testid="logo-word" aria-hidden="true">
        {[...WORD].map((c) => (
          <path key={c} d={LETTER_PATHS[c]} fill={c === 'X' ? BRAND.green : IMAGO_INK} data-letter={c} />
        ))}
      </svg>
    </svg>
  );
}

/** The CUBRAX isotype (dimension line + 3/4 hard hat + ruler, vector, transparent): `size` is its HEIGHT in px. `variant="stacked"` = isotype with the lettering centred under it, `"imagotype"` = lettering on the right (both sized by classes). */
export function Logo({ size = 40, className = '', variant = 'mark', isPro }) {
  // PRO state: explicit `isPro` wins, otherwise the app's own PRO flag (usePro) decides
  const appPro = usePro();
  const titanium = isPro ?? appPro;
  if (variant === 'imagotype' || variant === 'stacked') return <Imagotype className={className} stacked={variant === 'stacked'} titanium={titanium} />;
  // Hybrid isotype, sized by HEIGHT: static SVG dimension line on top, the supplied photoreal hard hat in the middle
  // (<img>, object-fit: contain, never distorted) and the static SVG ruler below, with transparent air in between.
  const k = size / MARK_LAYOUT.h;
  const w = Math.round(MARK_LAYOUT.w * k);
  const band = (level, art) => (
    <svg
      viewBox={`0 ${level.y} ${MARK_LAYOUT.w} ${level.h}`}
      width={w}
      height={level.h * k}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: art }}
    />
  );
  return (
    <span
      className={`inline-flex shrink-0 select-none flex-col items-center ${className}`}
      style={{ width: w, height: size }}
      data-testid="logo"
    >
      {band(MARK_LAYOUT.dimension, DIM_ART)}
      <img
        src={`${import.meta.env.BASE_URL}${HELMET_FILE}`}
        alt=""
        draggable="false"
        data-testid="logo-helmet"
        data-titanium={titanium ? 'true' : undefined}
        className={titanium ? TITANIUM_HELMET : undefined}
        style={{
          display: 'block',
          flex: 'none',
          width: w,
          height: MARK_LAYOUT.helmet.h * k,
          marginTop: MARK_LAYOUT.gapTop * k,
          objectFit: 'contain',
        }}
      />
      <span style={{ display: 'block', marginTop: MARK_LAYOUT.gapBottom * k }}>{band(MARK_LAYOUT.ruler, RULER_ART)}</span>
    </span>
  );
}

/** The CUBRAX lettering (geometric sans, white, green X). Decorative: put the accessible name next to it. */
export function Wordmark({ height = 28, className = '' }) {
  return (
    <svg viewBox={WORD_VIEWBOX} height={height} width={Math.round((height * WORD_BOX.w) / WORD_BOX.h)} aria-hidden="true" focusable="false" className={className} data-testid="wordmark">
      {[...WORD].map((c) => (
        <path key={c} d={LETTER_PATHS[c]} fill={c === 'X' ? BRAND.green : IMAGO_INK} />
      ))}
    </svg>
  );
}

const VARIANTS = {
  primary: 'bg-brand text-black hover:bg-brand-light',
  secondary: 'border border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10',
  ghost: 'border border-white/10 text-neutral-200 hover:bg-white/5',
  danger: 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20',
};

export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-[52px] select-none items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/**
 * Numeric field that NEVER opens the OS keyboard: the input is read-only with inputMode="none", and tapping it (or Enter / Space)
 * slides up the app's own NumberPad (big keys, backspace, a giant "Confirm"). Every valid keystroke calls `onChange(n)` at once;
 * "Reset" empties the field (null). Emits a number (or null). Range validation is reported through `error` by the parent.
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  decimals = 2,
  error,
  hint,
  placeholder,
  optional,
  hideLabel = false,
  className = '',
  testId,
  'aria-label': ariaLabel,
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = value === null || value === undefined ? '' : String(value);
  const title = label || ariaLabel || '';

  return (
    <div className={className}>
      {label && !hideLabel && (
        <label htmlFor={id} className="label">
          {label}
          {optional && <span className="ml-2 font-normal text-neutral-400">({optional})</span>}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="none"
          readOnly
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={shown}
          placeholder={placeholder}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(true);
            }
          }}
          aria-haspopup="dialog"
          aria-invalid={error ? 'true' : 'false'}
          aria-label={hideLabel ? ariaLabel || label : undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          data-testid={testId}
          data-numpad="true"
          className={`field-input cursor-pointer ${unit ? 'pr-16' : ''}`}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-base font-semibold text-neutral-300">
            {unit}
          </span>
        )}
      </div>
      {(error || hint) && (
        <p id={`${id}-msg`} className={`mt-1.5 text-sm ${error ? 'font-semibold text-red-400' : 'text-neutral-400'}`}>
          {error || hint}
        </p>
      )}
      {open && (
        <NumberPad
          testId="field-numpad"
          title={title}
          unit={unit || ''}
          value={typeof value === 'number' ? value : null}
          decimals={decimals}
          foot={hint && !error ? hint : ''}
          onChange={onChange}
          onReset={() => {
            onChange(null);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Open the native calendar (Chromium / Safari 16+); a browser without showPicker, or a refused call, just keeps the normal field. */
export function openDatePicker(input) {
  try {
    input?.showPicker?.();
  } catch {
    /* NotAllowedError (no user gesture) / SecurityError: the field stays usable by keyboard */
  }
}

/**
 * Every <input type="date"> of the app: the browser's small calendar icon is hidden by CSS (see .date-input in
 * index.css) and the WHOLE field opens the calendar on tap / click.
 */
export function DateInput({ className = '', onClick, ...props }) {
  return (
    <input
      type="date"
      {...props}
      onClick={(e) => {
        openDatePicker(e.currentTarget);
        onClick?.(e);
      }}
      className={`field-input date-input cursor-pointer [color-scheme:dark] ${className}`}
    />
  );
}

export function TextField({ label, value, onChange, onBlur, placeholder, maxLength = 80, optional, sanitize, testId, type = 'text', inputMode, end = null, flat = false }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {optional && <span className="ml-2 font-normal text-neutral-400">({optional})</span>}
      </label>
      <div className={end ? 'relative' : undefined}>
        <input
          id={id}
          type={type}
          inputMode={inputMode || (type === 'tel' ? 'tel' : undefined)}
          autoComplete="off"
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(sanitize ? sanitize(e.target.value) : e.target.value)}
          onBlur={onBlur}
          data-testid={testId}
          className={`field-input ${end ? 'pr-12' : ''} ${flat ? 'border-transparent bg-neutral-900/50' : ''}`.trim()}
        />
        {end && <span className="absolute inset-y-0 right-0 flex items-center">{end}</span>}
      </div>
    </div>
  );
}

export function Segmented({ label, value, options, onChange }) {
  return (
    <div role="radiogroup" aria-label={label}>
      {label && <span className="label">{label}</span>}
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`min-h-[52px] rounded-xl border px-3 font-semibold transition ${
              value === o.value ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Slider({ label, description, value, min, max, step = 1, suffix = '%', onChange }) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <div className="card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-lg font-medium">
            {label}
          </label>
          {description && <p className="text-sm text-neutral-400">{description}</p>}
        </div>
        <span className="rounded-lg bg-brand px-3 py-1 text-xl font-medium tabular-nums text-black">
          {value}
          {suffix}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${label} -${step}`}
          onClick={() => onChange(clamp(value - step))}
          className="h-12 w-12 shrink-0 rounded-xl border border-white/10 bg-white/5 text-2xl font-medium hover:bg-white/10"
        >
          −
        </button>
        <input
          id={id}
          type="range"
          className="slider"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ '--p': `${pct}%` }}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <button
          type="button"
          aria-label={`${label} +${step}`}
          onClick={() => onChange(clamp(value + step))}
          className="h-12 w-12 shrink-0 rounded-xl border border-white/10 bg-white/5 text-2xl font-medium hover:bg-white/10"
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Toggle switch on a pure-black card with an ultra-thin border. The whole row is the touch target
 * (one-hand friendly) and it is exposed as role="switch" with its label and description.
 */
export function Switch({ checked, onChange, label, description, className = '', ...rest }) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-l`}
      aria-describedby={description ? `${id}-d` : undefined}
      onClick={() => onChange(!checked)}
      className={`no-print card flex min-h-[64px] w-full select-none items-center gap-4 text-left transition active:scale-[0.99] ${className}`}
      {...rest}
    >
      <span className="min-w-0 flex-1">
        <span id={`${id}-l`} className="block font-semibold">
          {label}
        </span>
        {description && (
          <span id={`${id}-d`} className="mt-0.5 block text-sm text-neutral-400">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors ${checked ? 'border-brand bg-brand/20' : 'border-white/20 bg-black'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full transition-transform ${checked ? 'translate-x-6 bg-brand' : 'translate-x-0 bg-white/40'}`}
        />
      </span>
    </button>
  );
}

export function Badge({ children, tone = 'green' }) {
  const tones = {
    green: 'bg-brand/15 text-brand-light border-brand/40',
    white: 'bg-white/10 text-neutral-200 border-white/30',
  };
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
