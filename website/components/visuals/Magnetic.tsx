'use client';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/* ------------------------------------------------------------------
   Magnetic — a tiny magnetic pull for buttons/links. The wrapper
   follows the pointer with a lerped spring and releases on leave.
   Fine-pointer only; killed by reduced motion / reduce-motion /
   data-art="off". Purely additive, no layout shift.
   ------------------------------------------------------------------ */
export type MagneticProps = {
  children: ReactNode;
  strength?: number;
  className?: string;
  style?: CSSProperties;
};

export function Magnetic({ children, strength = 0.18, className = '', style }: MagneticProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const root = document.documentElement;
    const fine = typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const off = () =>
      !fine ||
      root.classList.contains('reduce-motion') ||
      root.dataset.art === 'off' ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (off()) return;

    let box: DOMRect | null = null;
    let tx = 0, ty = 0, cx = 0, cy = 0, frame = 0, active = false;

    const loop = () => {
      cx += (tx - cx) * 0.16;
      cy += (ty - cy) * 0.16;
      el.style.transform = `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0)`;
      if (active || Math.abs(tx - cx) > 0.08 || Math.abs(ty - cy) > 0.08) {
        frame = requestAnimationFrame(loop);
      } else {
        frame = 0;
        el.style.transform = '';
      }
    };
    const wake = () => { if (!frame) frame = requestAnimationFrame(loop); };

    const onEnter = () => {
      box = el.getBoundingClientRect();
      active = true;
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!box) box = el.getBoundingClientRect();
      tx = (e.clientX - (box.left + box.width / 2)) * strength;
      ty = (e.clientY - (box.top + box.height / 2)) * strength;
      active = true;
      wake();
    };
    const onLeave = () => {
      tx = 0; ty = 0; active = false; box = null;
      wake();
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.style.transform = '';
    };
  }, [strength]);

  return (
    <span ref={ref} className={`art-magnetic ${className}`.trim()} style={style}>
      {children}
    </span>
  );
}
