'use client';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './InteractiveArt.css';

/* ------------------------------------------------------------------
   MagneticLink — a bounded magnetic pull for buttons/links. The wrapper
   translates (≤4px) and tilts (≤1.5deg) toward the cursor with a lerped
   spring, then eases back to rest on leave. Fine-pointer only; killed by
   reduced motion / .reduce-motion / data-art="off". Purely additive: no
   layout shift, no click interception, and NO focus handlers — keyboard
   focus and the global :focus-visible ring are left completely unchanged.
   ------------------------------------------------------------------ */

export type MagneticLinkProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** pull factor before clamping (default 0.14) */
  strength?: number;
  /** max translation in px, capped at 4 (default 4) */
  max?: number;
  /** max tilt in degrees, capped at 1.5 (default 1) */
  tilt?: number;
};

const HARD_CAP_PX = 4;
const HARD_CAP_DEG = 1.5;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function MagneticLink({
  children,
  className = '',
  style,
  strength = 0.14,
  max = 4,
  tilt = 1,
}: MagneticLinkProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const root = document.documentElement;
    const fine = typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const mm = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const off = () =>
      !fine ||
      root.classList.contains('reduce-motion') ||
      root.dataset.art === 'off' ||
      (mm ? mm.matches : false);

    if (off()) return;

    const cap = clamp(max, 0, HARD_CAP_PX);
    const tiltCap = clamp(tilt, 0, HARD_CAP_DEG);
    let box: DOMRect | null = null;
    let tx = 0, ty = 0, cx = 0, cy = 0, frame = 0, active = false;

    const loop = () => {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      const rot = tiltCap * (cx / (cap || 1));
      el.style.transform =
        `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0) rotate(${rot.toFixed(2)}deg)`;
      const moving = Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05;
      if (active || moving) {
        frame = requestAnimationFrame(loop);
      } else {
        frame = 0;
        el.style.transform = ''; // fully release so CSS hover states own the element
      }
    };
    const wake = () => { if (!frame && !off()) frame = requestAnimationFrame(loop); };
    const read = () => { box = el.getBoundingClientRect(); };

    const onEnter = () => { read(); active = true; wake(); };
    const onMove = (e: PointerEvent) => {
      if (!box) read();
      if (!box) return;
      tx = clamp((e.clientX - (box.left + box.width / 2)) * strength, -cap, cap);
      ty = clamp((e.clientY - (box.top + box.height / 2)) * strength, -cap, cap);
      active = true;
      wake();
    };
    const onLeave = () => { tx = 0; ty = 0; active = false; box = null; wake(); };
    const onPref = () => {
      if (off()) { if (frame) cancelAnimationFrame(frame); frame = 0; el.style.transform = ''; }
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    mm?.addEventListener('change', onPref);
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(onPref);
      mo.observe(root, { attributes: true, attributeFilter: ['data-art', 'class'] });
      return () => {
        mo.disconnect();
        if (frame) cancelAnimationFrame(frame);
        el.removeEventListener('pointerenter', onEnter);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
        mm?.removeEventListener('change', onPref);
        el.style.transform = '';
      };
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      mm?.removeEventListener('change', onPref);
      el.style.transform = '';
    };
  }, [strength, max, tilt]);

  return (
    <span ref={ref} className={`ia-magnetic ${className}`.trim()} style={style}>
      {children}
    </span>
  );
}
