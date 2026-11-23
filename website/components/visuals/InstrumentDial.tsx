'use client';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import './visuals.css';

/* ------------------------------------------------------------------
   InstrumentDial — a single, centred engineering instrument for the
   hero: 1px graduated rings, cardinal registration marks, one slow
   orbiting node with a light trail and a patient core pulse.

   * all geometry is derived from props + index only — no Date /
     Math.random — so server and client markup are identical
   * motion is transform / opacity only, paused offscreen, on a hidden
     tab and whenever motion is off (OS / .reduce-motion / data-art=off)
   * purely decorative: aria-hidden, pointer-transparent, SVG only
   ------------------------------------------------------------------ */
export type InstrumentDialProps = {
  /** rendered box in px (default 420); overridable via `style` */
  size?: number;
  /** graduation ticks around the dial, clamped 24–120 (default 72) */
  ticks?: number;
  /** seconds for one orbit of the node (default 26) */
  orbitDuration?: number;
  /** seconds for one core pulse (default 4.8) */
  pulseDuration?: number;
  /** caption printed at the top of the dial */
  caption?: string;
  /** small mono readout printed at the bottom-left */
  readout?: string;
  className?: string;
  style?: CSSProperties;
};

const C = 100;
const R = { boundary: 96, grad: 84, mid: 68, orbit: 52, core: 28 } as const;
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const polar = (radius: number, angle: number) => ({
  x: C + Math.cos(angle) * radius,
  y: C + Math.sin(angle) * radius,
});

export function InstrumentDial({
  size = 420,
  ticks = 72,
  orbitDuration = 26,
  pulseDuration = 4.8,
  caption = 'SADEEM / INSTRUMENT',
  readout = 'SYS · 01',
  className = '',
  style,
}: InstrumentDialProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tickCount = clamp(Math.round(ticks), 24, 120);
  const majorEvery = Math.max(1, Math.round(tickCount / 12));

  const { graduations, cardinal, satellites } = useMemo(() => {
    const g = Array.from({ length: tickCount }, (_, i) => {
      const a = (i / tickCount) * TAU - Math.PI / 2;
      const major = i % majorEvery === 0;
      const inner = polar(major ? 78 : 81, a);
      const outer = polar(90, a);
      return { i, major, inner, outer };
    });
    const axes = [-Math.PI / 2, 0, Math.PI / 2, Math.PI] as const;
    return {
      graduations: g,
      cardinal: axes.map((a) => polar(R.boundary, a)),
      satellites: axes.map((a) => polar(R.orbit, a)),
    };
  }, [tickCount, majorEvery]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionOff = () =>
      reduce.matches || root.classList.contains('reduce-motion') || root.dataset.art === 'off';

    if (motionOff() || !('IntersectionObserver' in window)) {
      svg.setAttribute('data-active', 'false');
      return;
    }

    let visible = false;
    const sync = () =>
      svg.setAttribute('data-active', visible && !document.hidden && !motionOff() ? 'true' : 'false');
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      visible = entry.isIntersecting;
      sync();
    }, { threshold: 0.04 });
    io.observe(svg);

    const onVis = () => sync();
    const onPref = () => sync();
    document.addEventListener('visibilitychange', onVis);
    reduce.addEventListener('change', onPref);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      reduce.removeEventListener('change', onPref);
    };
  }, []);

  const circumference = TAU * R.orbit;
  const css = {
    width: size,
    height: size,
    '--id-orbit': `${orbitDuration}s`,
    '--id-pulse': `${pulseDuration}s`,
    ...(style || {}),
  } as CSSProperties;

  return (
    <svg
      ref={svgRef}
      className={`idial ${className}`.trim()}
      style={css}
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-active="false"
    >
      {/* counter-rotating micro-dotted outer ring */}
      <g className="id-spin-rev">
        <circle cx={C} cy={C} r={R.boundary} className="id-ring id-ring--dotted" />
      </g>

      {/* static frame: boundary / graduation / mid / orbit tracks + ticks + registration */}
      <g className="id-frame">
        <circle cx={C} cy={C} r={R.boundary} className="id-ring id-ring--soft" />
        <circle cx={C} cy={C} r={R.grad} className="id-ring" />
        <circle cx={C} cy={C} r={R.mid} className="id-ring id-ring--dash" />
        <circle cx={C} cy={C} r={R.orbit} className="id-ring id-ring--strong" />
        {graduations.map((t) => (
          <line
            key={t.i}
            x1={t.inner.x} y1={t.inner.y} x2={t.outer.x} y2={t.outer.y}
            className={`id-tick${t.major ? ' id-tick--major' : ''}`}
          />
        ))}
        {cardinal.map((p, i) => (
          <g key={i} className="id-reg" transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`}>
            <line x1="-4" y1="0" x2="4" y2="0" />
            <line x1="0" y1="-4" x2="0" y2="4" />
          </g>
        ))}
      </g>

      {/* fixed reference satellites on the orbit track */}
      <g className="id-satellites">
        {satellites.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.4" />
        ))}
      </g>

      {/* the slow orbiting node + its light trail (one rigid group) */}
      <g className="id-orbit">
        <circle cx={C} cy={C} r={R.orbit} className="id-trail"
          strokeDasharray={`22 ${(circumference - 22).toFixed(2)}`} />
        <circle cx={C} cy={C} r={R.orbit} className="id-trail id-trail--bright"
          strokeDasharray={`6 ${(circumference - 6).toFixed(2)}`} />
        <g className="id-node" transform={`translate(${C + R.orbit} ${C})`}>
          <circle r="6" className="id-node-halo" />
          <circle r="3" className="id-node-dot" />
          <circle r="1" className="id-node-glint" />
        </g>
      </g>

      {/* patient core pulse: reticle ring + cross + centre dot */}
      <g className="id-pulse">
        <circle cx={C} cy={C} r={R.core} className="id-core-ring" />
        <path d={`M${C} ${C - 16}v7M${C} ${C + 9}v7M${C - 16} ${C}h7M${C + 9} ${C}h7`}
          className="id-core-cross" />
        <circle cx={C} cy={C} r="2" className="id-core-dot" />
      </g>

      <text className="id-label id-label--caption" x={C} y="13" textAnchor="middle">{caption}</text>
      <text className="id-label id-label--readout" x="6" y="196" textAnchor="start">{readout}</text>
      <text className="id-label id-label--readout" x="194" y="196" textAnchor="end">360°</text>
    </svg>
  );
}
