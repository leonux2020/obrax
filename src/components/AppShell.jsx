/**
 * The permanent black frame of the main view. While IndexedDB is read (projects === null) the app NEVER renders nothing: this block
 * holds the place of the list (same width, same padding, bottom navigation kept by the caller), so the tree and the black background
 * stay in the DOM and the screen cannot blink between "empty" and "loaded". Only the inside of the container shows the loading state.
 */
export default function AppShell() {
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl bg-black px-3 pb-44 pt-3 sm:px-4" data-testid="app-shell" aria-busy="true">
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-white/10 bg-black" />
        ))}
      </div>
    </main>
  );
}
