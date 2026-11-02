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
