import { useId } from 'react';

/**
 * Minimal percentage control: the title, ONE continuous range slider and the current number in a green pill above the right end of the rail
 * (a single thumb, no preset buttons). The value is always an integer inside [min, max].
 * `disabled` (read-only): fill and handle turn CEMENT GREY (#737373, see index.css) instead of a dimmed green, and the pill drops the
 * bright green for a white outline; the NUMBER stays pure white at full contrast so it is readable in the sun. Only unlocked = green.
 */
export default function PercentSlider({ label, value, min = 0, max = 100, step = 1, suffix = '%', onChange, testId, disabled = false }) {
  const id = useId();
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const shown = clamp(Number.isFinite(value) ? value : min);
  const pct = max > min ? ((shown - min) / (max - min)) * 100 : 0;
  return (
    <div data-testid={testId}>
      {/* the title on the left; the value sits in a small green pill floating over the right end of the rail */}
      <div className="mb-0.5 flex items-end justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-neutral-200">
          {label}
        </label>
        <output htmlFor={id} data-testid={`${testId}-value`} className={`rounded-md px-2 py-0.5 text-sm font-medium tabular-nums leading-tight ${disabled ? 'border border-white/40 bg-black text-neutral-200' : 'bg-brand text-black'}`}>
          {shown}
          {suffix}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className={`slider-min ${disabled ? 'slider-locked' : ''}`}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={shown}
        style={{ '--p': `${pct}%` }}
        data-testid={`${testId}-input`}
        onChange={(e) => onChange(clamp(Math.round(Number(e.target.value))))}
      />
    </div>
  );
}
