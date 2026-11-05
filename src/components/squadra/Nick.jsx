/**
 * The NICKNAME ("apodo") of a person, written after their name in a quiet tone: Juan Pérez “El Flaco”. Inline, so it shares the
 * truncation of the name's line. Renders nothing without one. (Typographic quotes: they read as a nickname in every language.)
 */
export default function Nick({ apodo, testId }) {
  const text = String(apodo ?? '').trim();
  if (!text) return null;
  return (
    <span data-testid={testId} className="font-normal text-neutral-400">
      {' '}
      “{text}”
    </span>
  );
}
