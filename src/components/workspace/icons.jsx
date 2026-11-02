// Thin outline icons of Zone B (24 px grid, 1.5 px line, round caps and joins), drawn after Lucide's Users, Calculator, Banknote,
// BookOpen, Receipt and TriangleAlert. They draw with `currentColor`, so each one takes the colour of the text next to it.
// (No icon package is installed: they are inlined, ~1 KB in total.) The partidas keep TaskIcon, the same line language (3 / 48 = 1.5 / 24).
export const Outline = ({ children, size = 22, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    data-outline-icon="true"
    className={`shrink-0 ${className}`}
  >
    {children}
  </svg>
);

export const UsersIcon = (props) => (
  <Outline {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Outline>
);

export const CalculatorIcon = (props) => (
  <Outline {...props}>
    <rect width="16" height="20" x="4" y="2" rx="2" />
    <path d="M8 6h8" />
    <path d="M16 14v4" />
    <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01" />
  </Outline>
);

export const BanknoteIcon = (props) => (
  <Outline {...props}>
    <rect width="20" height="12" x="2" y="6" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01M18 12h.01" />
  </Outline>
);

export const BookOpenIcon = (props) => (
  <Outline {...props}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Outline>
);

export const ReceiptIcon = (props) => (
  <Outline {...props}>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Outline>
);

export const AlertTriangleIcon = (props) => (
  <Outline {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Outline>
);

export const TractorIcon = (props) => (
  <Outline {...props}>
    <path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20" />
    <path d="M16 18h-5" />
    <path d="M18 5a1 1 0 0 0-1 1v5.573" />
    <path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246" />
    <path d="M4 11V4" />
    <path d="M7 15h.01" />
    <path d="M8 10.1V4" />
    <circle cx="18" cy="18" r="2" />
    <circle cx="7" cy="15" r="5" />
  </Outline>
);

export const LockIcon = (props) => (
  <Outline {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Outline>
);

export const UnlockIcon = (props) => (
  <Outline {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Outline>
);

// Lucide Bell: the global alerts centre (Dashboard header).
export const BellIcon = (props) => (
  <Outline {...props}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Outline>
);

// ---- the roles of the crew (one thin outline icon per specialty, same 1.5 px language) ----------------------------------------
export const UserIcon = (props) => (
  <Outline {...props}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Outline>
);

export const ZapIcon = (props) => (
  <Outline {...props}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </Outline>
);

export const WrenchIcon = (props) => (
  <Outline {...props}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Outline>
);

export const HammerIcon = (props) => (
  <Outline {...props}>
    <path d="m15 12-8.37 8.37a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.91-1.91A2 2 0 0 1 19 8.17V7l-2.26-2.26a6 6 0 0 0-4.2-1.76L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.17a2 2 0 0 1 1.41.59L18.5 14.5" />
  </Outline>
);

export const FlameIcon = (props) => (
  <Outline {...props}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </Outline>
);

export const BrushIcon = (props) => (
  <Outline {...props}>
    <path d="M18 3l3 3-9 9-3-3z" />
    <path d="M9 12c-3 0-4 2-4 4s-1 4-3 5c4 1 9 0 9-5" />
  </Outline>
);

export const LeafIcon = (props) => (
  <Outline {...props}>
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
  </Outline>
);

export const BrickWallIcon = (props) => (
  <Outline {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M12 9v6" />
    <path d="M8 3v6" />
    <path d="M16 3v6" />
    <path d="M8 15v6" />
    <path d="M16 15v6" />
  </Outline>
);

export const HardHatIcon = (props) => (
  <Outline {...props}>
    <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
    <path d="M14 6a6 6 0 0 1 6 6v3" />
    <path d="M4 15v-3a6 6 0 0 1 6-6" />
    <rect x="2" y="15" width="20" height="4" rx="1" />
  </Outline>
);

/** specialty -> icon: Zap = electrician, Wrench = plumber, User = generic (multi-skilled / other). */
export const SPECIALTY_ICON = Object.freeze({
  multi: UserIcon,
  laborer: HardHatIcon,
  electrician: ZapIcon,
  plumber: WrenchIcon,
  carpenter: HammerIcon,
  welder: FlameIcon,
  finishing: BrushIcon,
  gardener: LeafIcon,
  mason: BrickWallIcon,
  other: UserIcon,
});
