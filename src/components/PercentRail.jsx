import { useEffect, useRef } from 'react';

/**
 * Horizontal selector: one row of big touch targets that scrolls sideways (thumb friendly). The current value
 * is always one of the options, even when it was set somewhere else with an unusual number.
 */
export default function PercentRail({ label, value, presets, min = 0, max = 100, suffix = '%', onChange, testId }) {
  const options = [...new Set([...presets, value])].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
  const current = useRef(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, []);
  return (
    <div data-testid={testId}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span id={`${testId}-l`} className="text-sm font-bold text-neutral-200">
          {label}
        </span>
        <span className="text-sm font-extrabold tabular-nums text-brand" aria-hidden="true">
          {value}
          {suffix}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={`${testId}-l`} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((v) => {
          const on = v === value;
          return (
            <button
              key={v}
              ref={on ? current : null}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`${testId}-${v}`}
              onClick={() => onChange(v)}
              className={`min-h-[48px] min-w-[58px] shrink-0 snap-center rounded-xl border-2 px-3 text-base font-extrabold tabular-nums transition ${
                on ? 'border-brand bg-brand text-black' : 'border-white/10 text-neutral-200 hover:border-white/30'
              }`}
            >
              {v}
              {suffix}
            </button>
          );
        })}
      </div>
    </div>
  );
}
