/**
 * A titled accordion (<details>/<summary>) for the secondary blocks of Zone B: crew, machinery, finance, expenses. Same
 * language as the partidas: a 2 px left border and quiet lettering, no solid fills. `meta` is the short figure on the right.
 */
export default function Block({ id, title, meta = '', open, onToggle, children, testId }) {
  return (
    <details
      open={Boolean(open)}
      onToggle={(e) => e.currentTarget.open !== Boolean(open) && onToggle(id, e.currentTarget.open)}
      className="group rounded-xl border border-l-2 border-white/10 border-l-white/30"
      data-testid={testId}
    >
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-3 text-sm font-bold uppercase tracking-wider text-[#E0E0E0]/80 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta && <span className="shrink-0 text-xs font-semibold normal-case tracking-normal tabular-nums text-[#E0E0E0]/70">{meta}</span>}
        <span aria-hidden="true" className="text-lg text-[#E0E0E0]/50 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="border-t border-white/10 px-3 py-4">{children}</div>
    </details>
  );
}
