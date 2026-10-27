/**
 * Read-only wrapper for everything that moves the quote. While the budget is frozen or signed the controls inside are
 * really disabled (a <fieldset disabled>: no focus, no keyboard) and a transparent shield on top answers every tap with
 * `onBlocked` (the "Precios bloqueados" toast), so a locked screen never feels dead. Unlocked: it renders the children as is.
 * (The shield is a SIBLING of the fieldset: a button inside a disabled fieldset would be disabled too.)
 */
export default function LockedZone({ locked, onBlocked, children, className = '' }) {
  if (!locked) return <div className={className}>{children}</div>;
  return (
    <div className="relative" data-locked="true">
      <fieldset disabled className="m-0 min-w-0 border-0 p-0 opacity-60">
        <div className={className}>{children}</div>
      </fieldset>
      <div aria-hidden="true" onClick={onBlocked} data-testid="locked-shield" className="absolute inset-0 z-10 cursor-not-allowed" />
    </div>
  );
}
