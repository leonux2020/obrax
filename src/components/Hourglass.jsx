/** Hourglass: "a rented tool must go back today" (leak prevention). Gold on black, never colour alone: it has a label. */
export default function Hourglass({ label, size = 22, className = '' }) {
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="hourglass"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#e8c35f"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 2h12M6 22h12" />
      <path d="M7 2c0 5 3 6 5 10-2 4-5 5-5 10M17 2c0 5-3 6-5 10 2 4 5 5 5 10" />
    </svg>
  );
}
