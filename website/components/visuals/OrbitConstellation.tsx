'use client';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import './visuals.css';

/* ------------------------------------------------------------------
   OrbitConstellation — a precision sky of 1px orbital rings and nodes
   placed at the golden angle (fully deterministic, hydration-safe).

   * pointer parallax + a slow scroll-linked spin, both transform only
   * SVG geometry → no canvas, so no device-pixel-ratio work to cap
   * pauses offscreen and when the tab is hidden
   * reduced motion / reduce-motion / data-art="off" → static art
   ------------------------------------------------------------------ */
export type OrbitConstellationProps = {
  /** rendered box in px (default 360); overridable via `style` */
  size?: number;
  /** concentric rings, clamped 1–6 (default 4) */
  rings?: number;
  /** nodes, clamped 4–48 (default 18) */
  nodes?: number;
  /** pointer parallax strength, 0–1 (default 0.55) */
  parallax?: number;
  /** enable the subtle scroll-linked spin (default true) */
  spin?: boolean;
  /** optional mono caption rendered inside the viewBox */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Pt = { i: number; x: number; y: number; r: number; accent: boolean };

export function OrbitConstellation({
  size = 360,
  rings = 4,
  nodes = 18,
  parallax = 0.55,
  spin = true,
  label,
  className = '',
  style,
}: OrbitConstellationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const parRef = useRef<SVGGElement>(null);
  const spinRef = useRef<SVGGElement>(null);

  const ringCount = clamp(Math.round(rings), 1, 6);
  const nodeCount = clamp(Math.round(nodes), 4, 48);
  const par = clamp(parallax, 0, 1);

  const { ringRadii, points, chords } = useMemo(() => {
    const radii = Array.from({ length: ringCount }, (_, k) => 15 + k * (33 / ringCount));
    const pts: Pt[] = Array.from({ length: nodeCount }, (_, i) => {
      const a = i * GOLDEN;
      const r = radii[i % ringCount];
      return {
        i,
        x: 50 + Math.cos(a) * r,
        y: 50 + Math.sin(a) * r,
        r: 0.7 + (i % 3) * 0.32,
        accent: i % 4 === 0,
      };
    });
    const links: Array<[number, number]> = [];
    for (let i = 0; i < nodeCount; i += 3) links.push([i, (i + 5) % nodeCount]);
    return { ringRadii: radii, points: pts, chords: links };
  }, [ringCount, nodeCount]);

  useEffect(() => {
    const svg = svgRef.current;
    const parG = parRef.current;
    const spinG = spinRef.current;
    if (!svg || !parG || !spinG) return;

    const root = document.documentElement;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionOff = () =>
      reduce.matches || root.classList.contains('reduce-motion') || root.dataset.art === 'off';

    if (motionOff() || !('IntersectionObserver' in window)) {
      svg.setAttribute('data-active', 'false');
      return;
    }

    let visible = false;
    let px = 0, py = 0, tx = 0, ty = 0; // parallax rendered / target
    let s = 0, ts = 0;                    // spin rendered / target
    let raf = 0;

    const active = () => visible && !document.hidden && !motionOff();
    const sync = () => svg.setAttribute('data-active', active() ? 'true' : 'false');

    const frame = () => {
      raf = 0;
      if (!active()) return;
      px += (tx - px) * 0.09;
      py += (ty - py) * 0.09;
      s += (ts - s) * 0.07;
      const max = par * 2.6; // viewBox units (~9px at size 360)
      parG.setAttribute('transform', `translate(${(px * max).toFixed(3)} ${(py * max).toFixed(3)})`);
      if (spin) spinG.setAttribute('transform', `rotate(${(s * 22).toFixed(2)} 50 50)`);
      const settled =
        Math.abs(tx - px) < 0.002 && Math.abs(ty - py) < 0.002 && Math.abs(ts - s) < 0.002;
      if (!settled) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      sync();
      if (!raf && active()) raf = requestAnimationFrame(frame);
    };
    const halt = () => {
      sync();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    const onMove = (e: PointerEvent) => {
      if (!fine.matches || !active()) return;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      tx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      ty = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      wake();
    };
    const onScroll = () => {
      const r = svg.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      ts = clamp(1 - (r.top + r.height / 2) / vh, 0, 1);
      wake();
    };
    const onVis = () => (document.hidden ? halt() : wake());
    const onPref = () => (motionOff() ? halt() : wake());

    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      visible = entry.isIntersecting;
      if (visible) { onScroll(); wake(); } else halt();
    }, { threshold: 0.04 });
    io.observe(svg);

    fine.addEventListener('change', onPref);
    reduce.addEventListener('change', onPref);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      fine.removeEventListener('change', onPref);
      reduce.removeEventListener('change', onPref);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [par, spin]);

  const css = { width: size, height: size, ...(style || {}) } as CSSProperties;

  return (
    <svg
      ref={svgRef}
      className={`oc ${className}`.trim()}
      style={css}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-active="false"
    >
      <g ref={parRef}>
        <g className="oc-rings">
          {ringRadii.map((r, k) => (
            <circle key={k} cx="50" cy="50" r={r} className="oc-ring" style={{ '--i': k } as CSSProperties} />
          ))}
        </g>
        <g ref={spinRef} className="oc-spin">
          <g className="oc-chords">
            {chords.map(([a, b], k) => {
              const p1 = points[a], p2 = points[b];
              return (
                <line key={k} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  className="oc-chord" style={{ '--i': k % 6 } as CSSProperties} />
              );
            })}
          </g>
          <g className="oc-nodes">
            {points.map((p) => (
              <circle key={p.i} cx={p.x} cy={p.y} r={p.r}
                className={`oc-node${p.accent ? ' oc-node--accent' : ''}`}
                style={{ '--i': p.i % 9 } as CSSProperties} />
            ))}
          </g>
        </g>
        <g className="oc-core">
          <circle cx="50" cy="50" r="6" className="oc-core-ring" />
          <path d="M50 40v6M50 54v6M40 50h6M54 50h6" className="oc-core-cross" />
          <circle cx="50" cy="50" r="1" className="oc-core-dot" />
        </g>
      </g>
      {label && <text className="oc-label" x="3" y="97">{label}</text>}
    </svg>
  );
}
