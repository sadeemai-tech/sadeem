/* ------------------------------------------------------------------
   InkGrain — generated paper fibre, no external asset, no hooks.
   The noise is monochrome (saturate 0) and blended into the paper via
   --grain-blend / --grain-opacity, so it reads correctly in both
   light (multiply) and dark (screen) themes without hard-coded ink.
   ------------------------------------------------------------------ */
export function InkGrain() {
  return (
    <svg className="ink-grain" aria-hidden="true" preserveAspectRatio="none">
      <filter id="sadeem-ink-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.72"
          numOctaves="2"
          seed="11"
          stitchTiles="stitch"
          result="noise"
        />
        <feColorMatrix in="noise" type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#sadeem-ink-grain)" />
    </svg>
  );
}
