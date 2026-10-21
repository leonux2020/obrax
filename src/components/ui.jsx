import { useEffect, useId, useState } from 'react';
import { ICON_DATA_URI } from '../brand/icon.js';
import { sanitizeNumericText, parseDecimal } from '../lib/sanitize.js';

export function Logo({ size = 40, className = '' }) {
  return (
    <img
      src={ICON_DATA_URI}
      width={size}
      height={size}
      alt=""
      draggable="false"
      className={`select-none rounded-xl ${className}`}
    />
  );
}

const VARIANTS = {
  primary: 'bg-brand text-black hover:bg-brand-light',
  secondary: 'border-2 border-brand text-brand hover:bg-brand/10',
  ghost: 'border border-neutral-700 text-white hover:bg-neutral-900',
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

export function Badge({ children, tone = 'green' }) {
  const tones = {
    green: 'bg-brand/15 text-brand-light border-brand/40',
    white: 'bg-white/10 text-white border-white/30',
  };
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}
