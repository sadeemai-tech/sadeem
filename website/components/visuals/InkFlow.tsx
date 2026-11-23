'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import './visuals.css';

/* ------------------------------------------------------------------
   InkFlow — editorial ink hairlines that trace themselves when the
   band scrolls into view, with one restrained accent trickle that
   travels the primary path (paused offscreen / on a hidden tab).

   All geometry is fixed per variant — no Math.random / Date at render,
   so server and client markup are identical. `pathLength={1}` keeps the
   dash animation length-independent of the rendered width.
   ------------------------------------------------------------------ */
export type InkFlowProps = {
  /** fixed path set (default 'weave') */
  variant?: 'weave' | 'arc' | 'straight';
  /** rendered height in px (default 120); width is always 100% */
  height?: number;
  /** optional mono caption */
  label?: string;
  /** extra base delay in ms (default 0) */
  delay?: number;
  className?: string;
  style?: CSSProperties;
};

type Variant = NonNullable<InkFlowProps['variant']>;

const PATHS: Record<Variant, string[]> = {
  weave: [
    'M0 60 C220 60 260 20 480 40 S760 100 980 70 S1160 50 1200 60',
    'M0 70 C240 70 300 112 520 86 S800 34 1000 60 S1160 76 1200 70',
    'M0 60 C260 30 420 92 640 60 S980 40 1200 66',
  ],
  arc: [
    'M0 100 C300 100 340 12 600 30 S900 100 1200 24',
    'M0 112 C320 112 380 4 620 44 S920 112 1200 40',
    'M0 96 C280 70 460 26 700 52 S1020 92 1200 60',
  ],
  straight: [
    'M0 50 C300 48 420 52 620 50 S960 48 1200 50',
    'M0 58 C260 60 440 56 640 58 S980 60 1200 58',
    'M0 66 C280 64 460 68 660 66 S1000 64 1200 66',
  ],
};

type Dot = { x: number; y: number; accent?: boolean };
const NODES: Record<Variant, Dot[]> = {
  weave: [
    { x: 480, y: 40, accent: true }, { x: 520, y: 86 },
    { x: 980, y: 70, accent: true }, { x: 1000, y: 60 },
  ],
  arc: [
    { x: 600, y: 30, accent: true }, { x: 620, y: 44 },
    { x: 1200, y: 24, accent: true },
  ],
  straight: [
    { x: 620, y: 50, accent: true }, { x: 640, y: 58 },
    { x: 1200, y: 50, accent: true },
  ],
};

export function InkFlow({
  variant = 'weave',
  height = 120,
  label,
  delay = 0,
  className = '',
  style,
}: InkFlowProps) {
  const ref = useRef<SVGSVGElement>(null);
  const paths = PATHS[variant];
  const nodes = NODES[variant];

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const off = () => reduce.matches || root.classList.contains('reduce-motion') || root.dataset.art === 'off';

    if (!('IntersectionObserver' in window)) {
      svg.setAttribute('data-drawn', 'true');
      return;
    }

    let drawn = false;
    let visible = false;
    const sync = () => svg.setAttribute('data-active', visible && !document.hidden && !off() ? 'true' : 'false');

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        visible = entry.isIntersecting;
        if (visible && !drawn) { drawn = true; svg.setAttribute('data-drawn', 'true'); }
        sync();
      }
    }, { threshold: 0.05, rootMargin: '0px 0px -6% 0px' });
    io.observe(svg);

    const onVis = () => sync();
    const onPref = () => { if (off()) svg.setAttribute('data-active', 'false'); else sync(); };
    document.addEventListener('visibilitychange', onVis);
    reduce.addEventListener('change', onPref);

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      reduce.removeEventListener('change', onPref);
    };
  }, []);

  const css = { height, ...(style || {}) } as CSSProperties;

  return (
    <svg
      ref={ref}
      className={`if ${className}`.trim()}
      style={css}
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-drawn="false"
      data-active="false"
    >
      <g className="if-traces" style={{ '--if-delay': `${delay}ms` } as CSSProperties}>
        {paths.map((d, i) => (
          <path key={i} d={d} pathLength={1} className="if-path" style={{ '--i': i } as CSSProperties} />
        ))}
      </g>
      <path className="if-flow" d={paths[0]} pathLength={1} />
      <g className="if-nodes">
        {nodes.map((n, i) => (
          <g key={i} className="if-node" transform={`translate(${n.x} ${n.y})`} style={{ '--i': i } as CSSProperties}>
            <circle r="3.4" className="if-node-halo" />
            <circle r="1.4" className={`if-node-dot${n.accent ? ' if-node-dot--accent' : ''}`} />
          </g>
        ))}
      </g>
      {label && <text className="if-label" x="10" y="20">{label}</text>}
    </svg>
  );
}
