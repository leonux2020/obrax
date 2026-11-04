// Thin outline icons of Zone B (24 px grid, 1.5 px line, round caps and joins), drawn after Lucide's Users, Calculator, Banknote,
// BookOpen, Receipt and TriangleAlert. They draw with `currentColor`, so each one takes the colour of the text next to it.
// (No icon package is installed: they are inlined, ~1 KB in total.) The partidas keep TaskIcon, the same line language (3 / 48 = 1.5 / 24).
export const Outline = ({ children, size = 22, className = '', icon }) => (
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
    data-icon={icon}
    className={`shrink-0 ${className}`}
  >
    {children}
  </svg>
);

export const MapPinIcon = (props) => (
  <Outline icon="map-pin" {...props}>
    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </Outline>
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

/**
 * ADVANCES / pay to a person: COINS, the universal sign of cash in hand. A stack of coins (side view, top right) and a single coin seen
 * from the front (bottom left) with its centre mark. Same 24 px grid and 1.5 px line as the rest; the two shapes never overlap.
 */
export const CoinsIcon = (props) => (
  <Outline icon="coins" {...props}>
    <ellipse cx="16.5" cy="6" rx="4.5" ry="2.5" />
    <path d="M12 6v4c0 1.38 2.01 2.5 4.5 2.5S21 11.38 21 10V6" />
    <circle cx="8.5" cy="15.5" r="5.5" />
    <path d="M8.5 12.5v6" />
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

export const PickaxeIcon = (props) => (
  <Outline {...props}>
    <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999" />
    <path d="M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024" />
    <path d="M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069" />
    <path d="M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z" />
  </Outline>
);

export const RulerIcon = (props) => (
  <Outline {...props}>
    <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z" />
    <path d="m14.5 12.5 2-2" />
    <path d="m11.5 9.5 2-2" />
    <path d="m8.5 6.5 2-2" />
    <path d="m17.5 15.5 2-2" />
  </Outline>
);

export const PaintRollerIcon = (props) => (
  <Outline {...props}>
    <rect width="16" height="6" x="2" y="2" rx="2" />
    <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    <rect width="4" height="6" x="8" y="16" rx="1" />
  </Outline>
);

export const TilesIcon = (props) => (
  <Outline {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 12h18" />
    <path d="M12 3v18" />
  </Outline>
);

export const LayersIcon = (props) => (
  <Outline {...props}>
    <path d="m12 2 10 5-10 5L2 7z" />
    <path d="m2 12 10 5 10-5" />
    <path d="m2 17 10 5 10-5" />
  </Outline>
);

export const DoorIcon = (props) => (
  <Outline {...props}>
    <path d="M13 4h3a2 2 0 0 1 2 2v14" />
    <path d="M2 20h3" />
    <path d="M13 20h9" />
    <path d="M10 12v.01" />
    <path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" />
  </Outline>
);

export const TruckIcon = (props) => (
  <Outline {...props}>
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
    <path d="M15 18H9" />
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
    <circle cx="17" cy="18" r="2" />
    <circle cx="7" cy="18" r="2" />
  </Outline>
);

/** specialty -> icon: Zap = electrician, Wrench = plumber, User = generic (multi-skilled / other). */
export const SPECIALTY_ICON = Object.freeze({
  multi: UserIcon,
  foreman: HardHatIcon, // capocantiere
  laborer: PickaxeIcon, // manovale
  mason: BrickWallIcon, // muratore
  carpenter: RulerIcon, // carpentiere
  painter: PaintRollerIcon, // pittore
  tiler: TilesIcon, // piastrellista
  drywaller: LayersIcon, // cartongessista
  electrician: ZapIcon,
  plumber: WrenchIcon,
  smith: HammerIcon, // fabbro
  welder: FlameIcon,
  glazier: DoorIcon, // serramentista
  gardener: LeafIcon,
  operator: TruckIcon, // autista / macchinista
  finishing: BrushIcon,
  other: UserIcon,
});

export const LandmarkIcon = (props) => (
  <Outline {...props}>
    <path d="M3 22h18" />
    <path d="M6 18v-7" />
    <path d="M10 18v-7" />
    <path d="M14 18v-7" />
    <path d="M18 18v-7" />
    <path d="M12 2 20 7H4z" />
  </Outline>
);

export const CameraIcon = (props) => (
  <Outline {...props}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Outline>
);

// Export sheet: one quiet line icon per document (drawn after Lucide's FileSignature, FileCog, Table and CloudUpload).
export const FileSignatureIcon = (props) => (
  <Outline {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 17c1.4-2.4 2.4-3.4 3.2-2.2.8 1.3 1.6 1.2 4.8-1.3" />
  </Outline>
);

export const FileCogIcon = (props) => (
  <Outline {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <circle cx="12" cy="15" r="2" />
    <path d="M12 11.5v1.5M12 17v1.5M8.5 15h1.5M14 15h1.5" />
  </Outline>
);

export const TableIcon = (props) => (
  <Outline {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </Outline>
);

export const CloudUploadIcon = (props) => (
  <Outline {...props}>
    <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
    <path d="M12 12v9" />
    <path d="m16 16-4-4-4 4" />
  </Outline>
);

// Ajustes accordions: a phone (operations / sync) and a globe (language and country).
export const SmartphoneIcon = (props) => (
  <Outline {...props}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </Outline>
);

export const GlobeIcon = (props) => (
  <Outline {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </Outline>
);
