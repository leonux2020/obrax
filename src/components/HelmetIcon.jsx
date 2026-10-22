import { useId } from 'react';

/**
 * Premium gold hard hat for a site manager / civil engineer, drawn in a 3/4 view: the whole hat is turned
 * slightly on the diagonal, its left flank is visible, the curved visor projects toward the viewer and the
 * crest is a low, thin, aerodynamic band that follows the dome (no tall comb, so it never reads as a miner's
 * or fireman's helmet).
 *
 * Light comes from the front / upper-left: the body gradient runs #FDE08A -> #FBBF24 -> #D97706 from the
 * upper-left to the lower-right, and a transparent-to-dark overlay deepens the back-right of the dome.
 * Volume comes only from gradients (no external shadow), so the icon sits directly on OLED #000000.
 *
 * Shell and crest use absolute path commands only (tests read their geometry).
 */
export default function HelmetIcon({ size = 28, className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const body = `hh-body-${uid}`;
  const shade = `hh-shade-${uid}`;
  const visor = `hh-visor-${uid}`;
  const crest = `hh-crest-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      data-testid="helmet-icon"
    >
      <defs>
        {/* main metallic body: light front/upper-left -> dark back/lower-right */}
        <linearGradient id={body} x1="7" y1="6" x2="28" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FDE08A" />
          <stop offset="0.2" stopColor="#FBBF24" />
          <stop offset="0.62" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
        {/* extra falloff over the rear of the dome */}
        <linearGradient id={shade} x1="14" y1="0" x2="28" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.34" />
        </linearGradient>
        {/* visor: bright at the projecting front (left), darker toward the back (right) */}
        <linearGradient id={visor} x1="1" y1="24" x2="31" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FBBF24" />
          <stop offset="0.55" stopColor="#E88F0B" />
          <stop offset="1" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id={crest} x1="9" y1="6" x2="25" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FEF0B8" />
          <stop offset="0.5" stopColor="#FBBF24" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
      </defs>

      <g data-part="tilt" transform="rotate(-8 16 16)">
        {/* curved visor: a ring seen from above, with a longer peak projecting forward (left, toward the viewer) */}
        <path
          data-part="visor"
          d="M0.9 22.4C1.1 20 7 17.9 16 17.9S30.7 20 30.8 21.9C30.9 24.5 24.2 26.5 15.8 26.5S0.7 25.2 0.9 22.4Z"
          fill={`url(#${visor})`}
          stroke="#FBBF24"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* inner edge of the visor where it meets the shell */}
        <path d="M4.2 20.9C8 22.9 24.6 23 28.2 20.8" stroke="#000" strokeOpacity="0.4" strokeWidth="0.9" strokeLinecap="round" />

        {/* domed shell; its lower edge is a smile curve so the visor reads in perspective */}
        <path
          data-part="shell"
          d="M5.2 19.8C4.9 12.2 10 7.2 16.6 7.2C23.2 7.2 27.9 12.2 27.9 19.8C24 22.2 9 22.2 5.2 19.8Z"
          fill={`url(#${body})`}
          stroke="#FBBF24"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        <path d="M5.2 19.8C4.9 12.2 10 7.2 16.6 7.2C23.2 7.2 27.9 12.2 27.9 19.8C24 22.2 9 22.2 5.2 19.8Z" fill={`url(#${shade})`} />

        {/* left flank: seam between the front face and the visible left side */}
        <path d="M10.6 9.4C8.3 12 7.4 15.8 7.7 20.4" stroke="#000" strokeOpacity="0.38" strokeWidth="0.9" strokeLinecap="round" />

        {/* low, thin crest following the dome from front to back (about 1 unit above the shell, ~1.5 thick) */}
        <path
          data-part="crest"
          d="M10 10.1C12.2 7.3 14.4 6.3 16.8 6.3C20 6.3 22.6 7.6 24.4 10.5L23.2 11C21.7 8.8 19.6 7.8 16.8 7.8C14.8 7.8 12.8 8.7 11.1 10.9Z"
          fill={`url(#${crest})`}
          stroke="#FBBF24"
          strokeWidth="0.3"
          strokeLinejoin="round"
        />

        {/* specular highlight on the front / upper-left */}
        <path data-part="shine" d="M7.8 17.2C8 13.3 10 10.6 12.6 9.4" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
