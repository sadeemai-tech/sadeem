// ============================================================
// SADEEM — icon system (v2 design refresh)
// One cohesive 24×24 stroke-based icon set. Every icon shares
// stroke=currentColor, round caps/joins and consistent optical
// weight, so the whole app reads as one instrument panel.
// Usage: <IcFile size={16} className="..." strokeWidth={1.5} />
// ============================================================
import React from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

function base(p: IconProps): React.SVGProps<SVGSVGElement> {
  return {
    width: p.size ?? 16,
    height: p.size ?? 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: p.strokeWidth ?? 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: p.className,
    style: p.style,
    'aria-hidden': true,
  };
}

/* ---------- core chrome ---------- */

export const IcWorkspace = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2c.4 0 .8.16 1.06.44L11.5 6.7H19A1.5 1.5 0 0 1 20.5 8.2v9.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V6.5Z" />
    <path d="M3.5 10h17" opacity=".55" />
  </svg>
);

export const IcSessions = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="13" height="15" rx="1.6" />
    <rect x="9" y="7.5" width="11.5" height="12" rx="1.6" opacity=".55" />
  </svg>
);

export const IcGit = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6.5" cy="6" r="2.2" />
    <circle cx="6.5" cy="18" r="2.2" />
    <circle cx="17.5" cy="12" r="2.2" />
    <path d="M6.5 8.2v7.6M8.7 6h4.3a2 2 0 0 1 2 2v2.2M15 13.8V16a2 2 0 0 1-2 2H8.7" opacity=".7" />
  </svg>
);

export const IcMcp = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" opacity=".55" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" opacity=".55" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    <path d="M10.5 7h3M7 10.5v3M17 10.5v3M10.5 17h3" opacity=".45" />
  </svg>
);

export const IcUsage = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 19.5h16" opacity=".5" />
    <rect x="5.5" y="12" width="3" height="5" rx=".8" />
    <rect x="10.5" y="8.5" width="3" height="8.5" rx=".8" />
    <rect x="15.5" y="5" width="3" height="12" rx=".8" opacity=".6" />
  </svg>
);

/** SADEEM DNA — double helix (rail view 06 + DNA surfaces). */
export const IcDna = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7.5 3c0 4.7 9 4.3 9 9s-9 4.3-9 9" />
    <path d="M16.5 3c0 4.7-9 4.3-9 9s9 4.3 9 9" opacity=".5" />
    <path d="M9.4 5.8h5.2M9.4 18.2h5.2M8.4 10.4h7.2M8.4 13.6h7.2" opacity=".8" />
  </svg>
);

export const IcSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="10.8" cy="10.8" r="5.3" />
    <path d="m15 15 4.5 4.5" />
  </svg>
);

export const IcKeys = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="14.5" r="3.7" />
    <path d="m10.8 11.8 7.7-7.3M15.6 7.2l2.6 2.6M13 9.8l2.2 2.2" />
  </svg>
);

export const IcPreview = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
    <path d="M3.5 8.5h17M7 6.5h.01M9.2 6.5h.01" opacity=".6" />
    <path d="M9 16.2v-4.4l3.8 2.2L9 16.2Z" fill="currentColor" stroke="none" opacity=".8" />
  </svg>
);

export const IcTerminal = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
    <path d="m7.5 10 2.6 2.4-2.6 2.4M12.6 15h4" />
  </svg>
);

export const IcSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2.6" />
    <path d="M12 3.4 13 5.5a6.9 6.9 0 0 1 2.2.9l2.3-.7 1.5 2.6-1.7 1.7c.14.66.14 1.34 0 2l1.7 1.7-1.5 2.6-2.3-.7a6.9 6.9 0 0 1-2.2.9L12 20.6 11 18.5a6.9 6.9 0 0 1-2.2-.9l-2.3.7-1.5-2.6 1.7-1.7a6.6 6.6 0 0 1 0-2L5 10.3l1.5-2.6 2.3.7A6.9 6.9 0 0 1 11 5.5l1-2.1Z" opacity=".75" />
  </svg>
);

export const IcGem = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4.5h10l3.5 5L12 19.8 3.5 9.5l3.5-5Z" />
    <path d="M3.5 9.5h17M12 19.8 8.5 9.5 12 4.5l3.5 5L12 19.8Z" opacity=".55" />
  </svg>
);

/* ---------- composer & chat ---------- */

export const IcSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 12 20 4.5 15.8 20l-3.9-5.6L4.5 12Z" />
    <path d="M11.9 14.4 20 4.5" opacity=".6" />
  </svg>
);

export const IcStop = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor" stroke="none" opacity=".9" />
  </svg>
);

export const IcSpark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5c.7 4.4 2.6 6.3 7 7-4.4.7-6.3 2.6-7 7-.7-4.4-2.6-6.3-7-7 4.4-.7 6.3-2.6 7-7Z" />
    <path d="M18.8 15.8c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z" opacity=".7" />
  </svg>
);

export const IcPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IcCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </svg>
);

export const IcWarn = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4 21 19.5H3L12 4Z" />
    <path d="M12 10v4.2M12 17h.01" />
  </svg>
);

export const IcArrow = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
  </svg>
);

export const IcClone = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.8" />
    <path d="M15.5 5.5v-.7A1.8 1.8 0 0 0 13.7 3H5.8A1.8 1.8 0 0 0 4 4.8v7.9a1.8 1.8 0 0 0 1.8 1.8h.7" opacity=".65" />
  </svg>
);

export const IcGlobe = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M3.8 12h16.4M12 3.8c2.3 2.2 3.5 5 3.5 8.2s-1.2 6-3.5 8.2c-2.3-2.2-3.5-5-3.5-8.2s1.2-6 3.5-8.2Z" opacity=".7" />
  </svg>
);

export const IcShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6l7-2.5Z" />
    <path d="m9 11.8 2.2 2.2L15.4 9.6" opacity=".8" />
  </svg>
);

export const IcZap = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 3 5.5 13.5h5L11 21l7.5-10.5h-5L13 3Z" />
  </svg>
);

export const IcBranchMini = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6.5" cy="5.5" r="1.9" />
    <circle cx="6.5" cy="18.5" r="1.9" />
    <circle cx="17.5" cy="8" r="1.9" />
    <path d="M6.5 7.4v9.2M8.4 5.5h5.2a1.9 1.9 0 0 1 1.9 1.9v1M17.5 9.9c0 4-4.5 3.9-8 5.4" opacity=".7" />
  </svg>
);

/* ---------- files ---------- */

export const IcFile = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3.5h7L18.5 9v11a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5Z" />
    <path d="M13 3.5V9h5.5" opacity=".6" />
  </svg>
);

export const IcFolderOpen = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l1.8 1.8H19A1.5 1.5 0 0 1 20.5 8.3V10h-17V6.5Z" />
    <path d="m3.7 11.6 1.5 6.2c.17.7.8 1.2 1.5 1.2h11.6c.72 0 1.34-.5 1.5-1.2l1.5-6.2c.14-.62-.33-1.2-.97-1.2H4.67c-.64 0-1.11.58-.97 1.2Z" opacity=".8" />
  </svg>
);

export const IcFolderSpark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l1.8 1.8H19A1.5 1.5 0 0 1 20.5 8.3v2.2h-17V6.5Z" opacity=".7" />
    <path d="M3.5 10.5h17v7A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-7Z" />
    <path d="M12 12.4c.25 1.6.95 2.3 2.55 2.55-1.6.25-2.3.95-2.55 2.55-.25-1.6-.95-2.3-2.55-2.55 1.6-.25 2.3-.95 2.55-2.55Z" fill="currentColor" stroke="none" opacity=".85" />
  </svg>
);

export const IcImage = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
    <circle cx="8.6" cy="9.6" r="1.7" />
    <path d="m4.5 17.5 4.6-4.6a1.4 1.4 0 0 1 2 0l6.4 6.4M14.5 16l1.9-1.9a1.4 1.4 0 0 1 2 0l2.1 2.1" opacity=".8" />
  </svg>
);

/* ---------- composite tiles ---------- */

/** Squared tinted tile wrapping any icon — used by Welcome feature strips so
 *  every entry reads as one family. SURVEYOR v4: 4px corners (r-sm2). */
export function IconTile({
  icon,
  tone,
  size = 32,
}: {
  icon: React.ReactNode;
  tone: string;
  size?: number;
}) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--r-sm2)',
        background: 'color-mix(in srgb, ' + tone + ' 14%, transparent)',
        border: '1px solid color-mix(in srgb, ' + tone + ' 30%, transparent)',
        color: tone,
      }}
    >
      {icon}
    </span>
  );
}

