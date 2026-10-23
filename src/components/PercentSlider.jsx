import { useId } from 'react';

/**
 * Minimal percentage control: the title, ONE continuous range slider and the current number in a green pill above the right end of the rail
 * (a single thumb, no preset buttons). The value is always an integer inside [min, max].
 */
export default function PercentSlider({ label, value, min = 0, max = 100, step = 1, suffix = '%', onChange, testId }) {
  const id = useId();
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const shown = clamp(Number.isFinite(value) ? value : min);
  const pct = max > min ? ((shown - min) / (max - min)) * 100 : 0;
  return (
    <div data-testid={testId}>
      {/* the title on the left; the value sits in a small green pill floating over the right end of the rail */}
      <div className="mb-0.5 flex items-end justify-between gap-3">
        <label htmlFor={id} className="text-sm font-bold text-neutral-200">
          {label}
        </label>
        <output htmlFor={id} data-testid={`${testId}-value`} className="rounded-md bg-brand px-2 py-0.5 text-sm font-extrabold tabular-nums leading-tight text-black">
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
