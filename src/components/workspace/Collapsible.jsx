import { useState } from 'react';

const MAX_CHIPS = 4;

/**
 * A quiet accordion: ONE row (title + a chevron) while it is closed, with small chips underneath that say what is inside; it opens only when the user
 * needs the detail. Native <details>, so it works without a script and the content stays in the DOM. No outlines: space and soft fills do the grouping.
 * @param chips  the short labels shown while closed (the first four, then "+n")
 */
export default function Collapsible({ title, chips = [], testId, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = chips.slice(0, MAX_CHIPS);
  const more = chips.length - shown.length;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid={testId} className="group">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden active:opacity-70">
        <span className="min-w-0 flex-1 text-sm font-normal text-neutral-200">{title}</span>
        {chips.length > 0 && <span className="text-xs font-light tabular-nums text-neutral-400">{chips.length}</span>}
        <span aria-hidden="true" className="text-lg text-neutral-500 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      {!open && chips.length > 0 && (
        <ul className="-mt-1 mb-1 flex flex-wrap gap-1.5" data-testid={testId ? `${testId}-chips` : undefined}>
          {shown.map((c, i) => (
            <li key={`${c}-${i}`} className="max-w-full truncate rounded-full bg-white/5 px-2.5 py-1 text-xs font-light text-neutral-300">
              {c}
            </li>
          ))}
          {more > 0 && <li className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-light text-neutral-400">+{more}</li>}
        </ul>
      )}
      <div className="pt-2">{children}</div>
    </details>
  );
}
