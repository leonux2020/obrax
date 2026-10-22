/** Minimal construction hard hat (outline only, inherits `currentColor`). */
export default function HelmetIcon({ size = 20, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-testid="helmet-icon"
    >
      <path d="M3 17h18" />
      <path d="M4.5 17v-1.5a7.5 7.5 0 0 1 15 0V17" />
      <path d="M10 8.3V17M14 8.3V17" />
      <path d="M2.5 17v1.2c0 .5.4.8.8.8h17.4c.4 0 .8-.3.8-.8V17" />
    </svg>
  );
}
