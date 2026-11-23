import type { CSSProperties } from 'react';

/* ------------------------------------------------------------------
   ArtCorner — a hand-drawn registration mark for plate corners:
   bracket, dashed orbit, crosshair, tick-ruler, registration plus
   and a mono coordinate readout. Server component, theme-agnostic
   (inherits currentColor / var(--accent)); no hooks.
   ------------------------------------------------------------------ */
export type ArtCornerProps = {
  corner?: 'tl' | 'tr' | 'bl' | 'br';
  label?: string;
  coord?: string;
  className?: string;
  style?: CSSProperties;
};

export function ArtCorner({ corner = 'tl', label, coord, className = '', style }: ArtCornerProps) {
  return (
    <span className={`artcorner artcorner--${corner} ${className}`.trim()} style={style} aria-hidden="true">
      <svg viewBox="0 0 88 88" fill="none" stroke="currentColor">
        <g strokeWidth="1">
          {/* plate bracket — deliberately uneven, like a hand-set rule */}
          <path d="M3 27V3h24" opacity=".55" />
          <circle cx="44" cy="44" r="11" strokeDasharray="1.5 3.5" opacity=".5" />
          <circle cx="44" cy="44" r="3.5" opacity=".8" />
          {/* crosshair, broken at the centre */}
          <path d="M44 21v13M44 54v13M21 44h13M54 44h13" opacity=".72" />
          {/* registration plus */}
          <path d="M69 15h9M73.5 10.5v9" opacity=".72" />
          {/* engraver's ruler */}
          <g opacity=".5">
            <path d="M4 59v7M10 59v3M16 59v5M22 59v3M28 59v7M34 59v3" />
          </g>
          <path d="M4 70h44" opacity=".28" />
        </g>
        <circle className="artcorner-dot" cx="44" cy="44" r="1.4" stroke="none" />
        <text className="artcorner-coord" x="4" y="84">{coord ?? 'X:000 / Y:000'}</text>
        {label && <text className="artcorner-label" x="84" y="10" textAnchor="end">{label}</text>}
      </svg>
    </span>
  );
}
