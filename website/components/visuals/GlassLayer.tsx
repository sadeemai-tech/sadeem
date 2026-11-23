'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import './visuals.css';

/* ==================================================================
   GlassLayer — a tasteful, additive "liquid glass" surface.

   It is a decorative, hit-test-free layer: a translucent paper tint,
   a real backdrop blur, a 1px translucent border and a soft inner
   highlight. Every colour comes from the existing design tokens via
   color-mix(), so it stays at home in both light and dark themes and
   never becomes a gradient soup. The host must be a positioning
   context (`.glass-host`); the layer paints above the host background
   but below its content.
   ================================================================== */
type GlassVars = CSSProperties & Record<`--${string}`, string>;

export type GlassLayerProps = {
  className?: string;
  style?: CSSProperties;
  /** host corner radius in px (or any CSS length) */
  radius?: number | string;
  /** backdrop blur strength in px */
  blur?: number;
  tone?: 'quiet' | 'regular' | 'bright';
  /** refraction character: 'calm' (default, less saturation) or 'regular' */
  refraction?: 'calm' | 'regular';
  /** add a fine specular hairline along the top edge (default true) */
  sheen?: boolean;
};

export function GlassLayer({
  className = '',
  style,
  radius,
  blur,
  tone = 'regular',
  refraction = 'calm',
  sheen = true,
}: GlassLayerProps) {
  const css: GlassVars = { ...(style || {}) } as GlassVars;
  if (radius !== undefined) css['--glass-radius'] = typeof radius === 'number' ? `${radius}px` : radius;
  if (blur !== undefined) css['--glass-blur'] = `${blur}px`;
  return (
    <span
      aria-hidden="true"
      className={`glass-layer ${className}`.trim()}
      data-tone={tone}
      data-refraction={refraction === 'regular' ? 'regular' : undefined}
      style={css}
    >
      {sheen && <span className="glass-layer__sheen" aria-hidden="true" />}
    </span>
  );
}

/* ------------------------------------------------------------------
   HeroCaustic — a gentle light pool that follows the pointer across
   the hero, positioned by --cx/--cy on a CSS radial gradient. Writes
   only to the DOM (no React state on pointermove), rAF-throttled, and
   never activates on touch, coarse pointers or reduced motion.
   ------------------------------------------------------------------ */
export function HeroCaustic({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const area = el?.parentElement;
    if (!el || !area) return;

    const root = document.documentElement;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const killed = () =>
      !fine.matches ||
      reduce.matches ||
      root.dataset.art === 'off' ||
      root.dataset.cursor === 'off' ||
      root.classList.contains('reduce-motion');

    if (killed()) {
      el.style.display = 'none';
      return;
    }

    let frame = 0;
    let running = false;
    let x = 50, y = 50;   // rendered position
    let tx = 50, ty = 50; // pointer target
    const EASE = 0.14;    // gentle follow, in step with the cursor halo

    const apply = () => {
      frame = 0;
      if (killed()) { running = false; el.dataset.on = 'false'; return; }
      x += (tx - x) * EASE;
      y += (ty - y) * EASE;
      el.style.setProperty('--cx', `${x.toFixed(2)}%`);
      el.style.setProperty('--cy', `${y.toFixed(2)}%`);
      if (Math.abs(tx - x) > 0.2 || Math.abs(ty - y) > 0.2) {
        frame = requestAnimationFrame(apply);
      } else {
        running = false;
      }
    };
    const schedule = () => {
      if (!running) { running = true; frame = requestAnimationFrame(apply); }
    };
    const onMove = (e: PointerEvent) => {
      if (killed()) return;
      const r = area.getBoundingClientRect();
      if (!r.width || !r.height) return;
      tx = ((e.clientX - r.left) / r.width) * 100;
      ty = ((e.clientY - r.top) / r.height) * 100;
      el.dataset.on = 'true';
      schedule();
    };
    const onLeave = () => { el.dataset.on = 'false'; };
    const onPreferenceChange = () => {
      if (killed()) {
        el.dataset.on = 'false';
        el.style.display = 'none';
        running = false;
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        el.style.display = '';
      }
    };

    area.addEventListener('pointermove', onMove, { passive: true });
    area.addEventListener('pointerleave', onLeave);
    fine.addEventListener('change', onPreferenceChange);
    reduce.addEventListener('change', onPreferenceChange);
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
      fine.removeEventListener('change', onPreferenceChange);
      reduce.removeEventListener('change', onPreferenceChange);
    };
  }, []);

  return <div ref={ref} className={`hero-caustic ${className}`.trim()} aria-hidden="true" />;
}
