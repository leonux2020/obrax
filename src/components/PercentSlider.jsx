import { useId } from 'react';

/**
 * Minimal percentage control: the title with the current number next to it and ONE continuous range slider
 * (a single thumb, no preset buttons). The value is always an integer inside [min, max].
 */
export default function PercentSlider({ label, value, min = 0, max = 100, step = 1, suffix = '%', onChange, testId }) {
  const id = useId();
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const shown = clamp(Number.isFinite(value) ? value : min);
  const pct = max > min ? ((shown - min) / (max - min)) * 100 : 0;
  return (
    <div data-testid={testId}>
      <div className="mb-1 flex items-baseline gap-2">
        <label htmlFor={id} className="text-sm font-bold text-neutral-200">
          {label}
        </label>
        <output htmlFor={id} data-testid={`${testId}-value`} className="text-sm font-extrabold tabular-nums text-brand">
          {shown}
          {suffix}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="slider-min"
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
