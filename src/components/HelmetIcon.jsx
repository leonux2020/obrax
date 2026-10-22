import { useId } from 'react';

/**
 * Premium gold hard hat (chief-engineer style): domed shell, raised central crest with two side ribs and a
 * curved front visor. A diagonal gold gradient (#FBBF24 -> #D97706) gives it a metallic body, a second
 * vertical gradient shades the visor and a soft white arc fakes the specular highlight. Engraved details
 * are pure black, so the icon sits on the OLED #000 background without any other fill.
 */
export default function HelmetIcon({ size = 28, className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const body = `hh-body-${uid}`;
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
        <linearGradient id={body} x1="6" y1="5" x2="27" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FDE08A" />
          <stop offset="0.18" stopColor="#FBBF24" />
          <stop offset="0.62" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
        <linearGradient id={visor} x1="0" y1="21" x2="0" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id={crest} x1="0" y1="3" x2="0" y2="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FDE08A" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
      </defs>

      {/* curved front visor / brim, wider than the shell, smile-shaped */}
      <path
        data-part="visor"
        d="M2 21.2c0-.7.5-1.2 1.2-1.2h25.6c.7 0 1.2.5 1.2 1.2 0 .5-.2.9-.6 1.2C26.6 25 21.8 26.6 16 26.6S5.4 25 2.6 22.4c-.4-.3-.6-.7-.6-1.2z"
        fill={`url(#${visor})`}
        stroke="#FBBF24"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* domed shell */}
      <path
        data-part="shell"
        d="M4.6 20.2C4.6 12 9.4 6.6 16 6.6s11.4 5.4 11.4 13.6z"
        fill={`url(#${body})`}
        stroke="#FBBF24"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* raised central crest (ridge) on top of the dome */}
      <path
        data-part="crest"
        d="M13.1 7.2V4.6c0-.9.6-1.6 1.5-1.6h2.8c.9 0 1.5.7 1.5 1.6v2.6z"
        fill={`url(#${crest})`}
        stroke="#FBBF24"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* engraved ribs running down both sides of the crest */}
      <path d="M13.1 7.4C12.2 11 11.9 15.5 11.9 20M18.9 7.4C19.8 11 20.1 15.5 20.1 20" stroke="#000" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" />
      {/* band where shell meets visor */}
      <path d="M4.6 20.2h22.8" stroke="#000" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" />
      {/* specular highlight on the upper-left of the dome */}
      <path data-part="shine" d="M7.4 17.4C7.7 12.8 10.3 9.6 13.6 8.6" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
