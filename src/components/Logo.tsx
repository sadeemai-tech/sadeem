// SADEEM brand mark — v11.5.0. The REAL brand logo, vector-traced from the
// official artwork: a flat lime (#A3E635) plate carrying the black 8-spike
// radiant mark. Flat fills only — zero gradients, zero other hues.
import React from 'react';

const MARK =
  'M421.9 0.0 L394.4 95.6 L366.8 139.8 L320.2 179.9 L190.9 179.9 L190.9 306.8 L158.0 356.9 L89.8 401.2 L0.0 424.8 L95.2 450.7 L160.4 496.2 L85.6 544.5 L0.0 566.4 L96.3 592.9 L165.2 641.9 L190.9 684.4 L190.9 810.6 L327.9 810.6 L367.4 846.6 L393.8 889.1 L421.9 985.3 L446.4 895.6 L493.7 827.7 L538.6 891.4 L565.5 985.3 L596.6 882.0 L622.4 843.1 L657.7 811.2 L830.6 810.6 L834.2 657.2 L867.7 625.4 L911.4 600.6 L1010.2 575.8 L922.2 550.4 L851.6 500.9 L919.2 457.2 L1013.8 434.2 L914.4 403.5 L843.8 346.3 L830.6 323.3 L830.6 179.9 L666.7 179.9 L600.2 110.3 L576.9 54.9 L565.5 0.0 L538.6 94.4 L493.7 158.1 L446.4 90.3 Z';

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-label="SADEEM"
      style={{ display: 'block' }}
    >
      <rect width="1024" height="1024" rx="216" fill="#A3E635" />
      <g transform="translate(202 202) scale(0.62)">
        <path d={MARK} fill="#000000" />
      </g>
    </svg>
  );
}
