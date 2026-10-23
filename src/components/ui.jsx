import { useEffect, useId, useState } from 'react';
import { LETTER_PATHS, MARK_DATA_URI, MARK_RATIO, WORD, WORD_BOX, BRAND } from '../brand/icon.js';
import { sanitizeNumericText, parseDecimal } from '../lib/sanitize.js';

/** The CUBRAX hard hat (3/4 view, vector, transparent): `size` is its width in px. */
export function Logo({ size = 40, className = '' }) {
  return (
    <img
      src={MARK_DATA_URI}
      width={size}
      height={Math.round(size * MARK_RATIO)}
      alt=""
      draggable="false"
      className={`select-none ${className}`}
    />
  );
}

/** The CUBRAX lettering (technological monoline, green X). Decorative: put the accessible name next to it. */
export function Wordmark({ height = 28, className = '' }) {
  return (
    <svg viewBox={`0 0 ${WORD_BOX.w} ${WORD_BOX.h}`} height={height} width={Math.round((height * WORD_BOX.w) / WORD_BOX.h)} aria-hidden="true" focusable="false" className={className} data-testid="wordmark">
      {[...WORD].map((c, i) => (
        <path key={c} d={LETTER_PATHS[c]} transform={`translate(${i * 72 + 2} 0)`} fill="none" stroke={c === 'X' ? BRAND.green : '#ffffff'} strokeWidth="12" strokeLinejoin="miter" strokeLinecap="square" />
      ))}
    </svg>
  );
}

const VARIANTS = {
  primary: 'bg-brand text-black hover:bg-brand-light',
  secondary: 'border-2 border-brand text-brand hover:bg-brand/10',
  ghost: 'border border-white/10 text-white hover:border-white/40',
  danger: 'border-2 border-red-500 text-red-400 hover:bg-red-500/10',
};

export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-[52px] select-none items-center justify-center gap-2 rounded-xl px-5 text-base font-bold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/**
 * Numeric input with strict sanitization: only digits and one decimal mark can ever be entered.
 * Emits a number (or null). Range validation is reported through `error` by the parent.
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
  'aria-label': ariaLabel,
}) {
  const id = useId();
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));

  // keep text in sync with external changes (reset, task switch) without fighting the user's typing
  useEffect(() => {
    const parsed = parseDecimal(text);
    const ext = value === undefined ? null : value;
    if (parsed !== ext) setText(ext === null ? '' : String(ext));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (e) => {
    const clean = sanitizeNumericText(e.target.value, decimals);
    setText(clean);
    onChange(parseDecimal(clean));
  };

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
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          value={text}
          placeholder={placeholder}
          onChange={handle}
          aria-invalid={error ? 'true' : 'false'}
          aria-label={hideLabel ? ariaLabel || label : undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={`field-input ${unit ? 'pr-16' : ''}`}
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

export function TextField({ label, value, onChange, placeholder, maxLength = 80, optional, sanitize }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {optional && <span className="ml-2 font-normal text-neutral-400">({optional})</span>}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(sanitize(e.target.value))}
        className="field-input"
      />
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
            className={`min-h-[52px] rounded-xl border-2 px-3 font-bold transition ${
              value === o.value ? 'border-brand bg-brand text-black' : 'border-neutral-700 text-white hover:border-neutral-500'
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
          <label htmlFor={id} className="text-lg font-bold">
            {label}
          </label>
          {description && <p className="text-sm text-neutral-400">{description}</p>}
        </div>
        <span className="rounded-lg bg-brand px-3 py-1 text-xl font-extrabold tabular-nums text-black">
          {value}
          {suffix}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${label} -${step}`}
          onClick={() => onChange(clamp(value - step))}
          className="h-12 w-12 shrink-0 rounded-xl border-2 border-neutral-700 text-2xl font-bold hover:border-brand"
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
          className="h-12 w-12 shrink-0 rounded-xl border-2 border-neutral-700 text-2xl font-bold hover:border-brand"
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
        <span id={`${id}-l`} className="block font-bold">
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
    white: 'bg-white/10 text-white border-white/30',
  };
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}
