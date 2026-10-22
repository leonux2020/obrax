import { useId } from 'react';

/**
 * Premium gold hard hat for a site manager / civil engineer, modern cap style, drawn in a 3/4 view:
 *  - a smooth domed shell with NO brim around it: the left flank is plain and clean;
 *  - one short curved visor that projects only at the front (toward the viewer, lower-left);
 *  - a low, thin, aerodynamic crest that follows the top of the dome.
 * The whole hat is tilted slightly on the diagonal. Light comes from the front / upper-left: the body
 * gradient runs #FDE08A -> #FBBF24 -> #D97706 from the upper-left to the lower-right and a
 * transparent-to-dark overlay deepens the back-right of the dome. Volume comes only from gradients
 * (no filters or external shadows), so the icon sits directly on OLED #000000.
 *
 * Shell, visor and crest use absolute path commands only (tests read their geometry).
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
        <linearGradient id={body} x1="7" y1="6" x2="29" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FDE08A" />
          <stop offset="0.2" stopColor="#FBBF24" />
          <stop offset="0.62" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
        {/* extra falloff over the rear of the dome */}
        <linearGradient id={shade} x1="14" y1="0" x2="29" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.34" />
        </linearGradient>
        {/* visor: catches the light at its projecting tip (front-left), darker toward the dome */}
        <linearGradient id={visor} x1="1" y1="21" x2="16" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FDE08A" />
          <stop offset="0.45" stopColor="#FBBF24" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
        <linearGradient id={crest} x1="9" y1="6" x2="25" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FEF0B8" />
          <stop offset="0.5" stopColor="#FBBF24" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
      </defs>

      <g data-part="tilt" transform="rotate(-8 16 16)">
        {/* short front visor only (drawn first so the shell overlaps its root) */}
        <path
          data-part="visor"
          d="M5.2 17.6C3.2 18.6 1.6 20.2 1.4 22.2C1.3 23.5 2.6 24.1 4.6 24.2C8 24.5 11.6 23.8 14 22.3C10.8 22.3 7.4 21.3 5.2 17.6Z"
          fill={`url(#${visor})`}
          stroke="#FBBF24"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* smooth domed shell; its lower edge is a gentle smile curve for the 3/4 perspective */}
        <path
          data-part="shell"
          d="M4.4 21C4 12.4 9.8 6.9 16.8 6.9C23.8 6.9 28.9 12.4 28.8 21C24.4 22.9 9 22.9 4.4 21Z"
          fill={`url(#${body})`}
          stroke="#FBBF24"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        <path d="M4.4 21C4 12.4 9.8 6.9 16.8 6.9C23.8 6.9 28.9 12.4 28.8 21C24.4 22.9 9 22.9 4.4 21Z" fill={`url(#${shade})`} />

        {/* low, thin crest following the dome from front to back (about 0.9 above the shell, ~1.5 thick) */}
        <path
          data-part="crest"
          d="M10 10C12.3 7.1 14.6 6.1 17 6.1C20.3 6.1 23 7.5 24.8 10.4L23.6 10.9C22 8.7 19.8 7.6 17 7.6C14.9 7.6 12.8 8.5 11.1 10.8Z"
          fill={`url(#${crest})`}
          stroke="#FBBF24"
          strokeWidth="0.3"
          strokeLinejoin="round"
        />

        {/* specular highlight on the front / upper-left */}
        <path data-part="shine" d="M7.4 17.6C7.5 13.4 9.8 10.4 12.8 9.2" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
