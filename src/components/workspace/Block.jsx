import BottomSheet from '../BottomSheet.jsx';

/**
 * The secondary blocks of the project (crew, parameters, advances, journal, expenses) as a tile of the quick-control grid, Android settings
 * style: a big dark circle with its thin outline icon (`icon`, 32 px) and a short label under it (`label`, falling back to `title`). `meta` is the
 * short figure (a %, a count) in small type under the label. `headerAction` replaces the x of the sheet's header (the sheet then closes the native way: device Back,
 * swipe down with `swipeToClose`, backdrop, Escape).
 *
 * Tapping the tile opens its content in a Bottom Sheet over the screen (nothing is pushed down the page). The sheet is a back-stack layer
 * (BottomSheet -> lib/backStack.js): the device's Back closes ONLY the sheet and the user stays in the project; closing it with the x, the
 * backdrop or Escape drops its history entry again. `open` / `onToggle(id, open)` keep the same contract the accordions had.
 */
export default function Block({ id, title, label, icon = null, meta = '', open, onToggle, children, testId, tall = false, headerAction = null, swipeToClose = false }) {
  return (
    <>
      <button
        type="button"
        onClick={() => onToggle(id, true)}
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
        aria-label={title}
        data-testid={testId}
        data-open={open ? 'true' : undefined}
        className="flex min-h-[44px] min-w-0 flex-col items-center rounded-2xl p-2 transition active:scale-95"
      >
        <span data-testid={`${testId}-circle`} className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/5 bg-neutral-900 text-neutral-200">
          {icon}
        </span>
        <span className="mt-2 w-full truncate text-center text-xs text-neutral-400">{label || title}</span>
        {meta && <span className="mt-0.5 w-full truncate text-center text-[11px] tabular-nums text-neutral-500">{meta}</span>}
      </button>
      {open && (
        <BottomSheet title={title} tall={tall} autoFocus={false} headerAction={headerAction} swipeToClose={swipeToClose} onClose={() => onToggle(id, false)}>
          <div className="mt-3" data-testid={`${testId}-sheet`}>
            {children}
          </div>
        </BottomSheet>
      )}
    </>
  );
}
