'use client';
import { useEffect, useRef } from 'react';
import './visuals.css';

/* ------------------------------------------------------------------
   CursorHalo — an 8px registration ring that eases behind the pointer.
   A second, slower ring trails it for a touch of instrument depth.

   The follow is a velocity-based (critically damped-feeling) spring
   rather than a fixed lerp, so it accelerates and settles smoothly.
   The loop stops once at rest and restarts on movement, pauses when
   the tab is hidden, and never runs on touch or reduced motion.

   Never intercepts input; disappears the instant reduced motion,
   html.reduce-motion, data-art="off" or data-cursor="off" is set.
   ------------------------------------------------------------------ */
export function CursorHalo() {
  const ref = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    const trail = trailRef.current;
    if (!el) return;

    const root = document.documentElement;
    const fine = typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const killed = () =>
      root.dataset.cursor === 'off' ||
      root.dataset.art === 'off' ||
      root.classList.contains('reduce-motion') ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (!fine || killed()) return;

    let tx = -100, ty = -100;
    let cx = -100, cy = -100, vx = 0, vy = 0;     // primary spring
    let bx = -100, by = -100;                       // trailing ring (slower lerp)
    let frame = 0;

    const loop = () => {
      if (killed() || document.hidden) {
        el.setAttribute('data-on', 'false');
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      // spring: stiffness pulls toward target, damping bleeds velocity
      vx = (vx + (tx - cx) * 0.22) * 0.72;
      vy = (vy + (ty - cy) * 0.22) * 0.72;
      cx += vx;
      cy += vy;
      // trailing ring eases more slowly toward the primary position
      bx += (cx - bx) * 0.12;
      by += (cy - by) * 0.12;

      el.style.transform = `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0) translate(-50%,-50%)`;
      if (trail) {
        trail.style.transform =
          `translate(-50%,-50%) translate3d(${(bx - cx).toFixed(2)}px,${(by - cy).toFixed(2)}px,0)`;
      }

      const moving =
        Math.abs(tx - cx) > 0.15 || Math.abs(ty - cy) > 0.15 ||
        Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05 ||
        Math.abs(cx - bx) > 0.15 || Math.abs(cy - by) > 0.15;
      if (moving) {
        frame = requestAnimationFrame(loop);
      } else {
        frame = 0; // rest: stop the loop entirely
      }
    };
    const wake = () => { if (!frame && !killed() && !document.hidden) frame = requestAnimationFrame(loop); };
    const onMove = (e: PointerEvent) => {
      if (killed()) return;
      tx = e.clientX;
      ty = e.clientY;
      el.setAttribute('data-on', 'true');
      wake();
    };
    const onLeave = () => el.setAttribute('data-on', 'false');
    const onVis = () => { if (document.hidden) onLeave(); else wake(); };
    const onPref = () => { if (killed()) { onLeave(); cancelAnimationFrame(frame); frame = 0; } };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onPref);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onPref);
    };
  }, []);

  return (
    <div ref={ref} className="art-cursor" aria-hidden="true">
      <span ref={trailRef} className="art-cursor__ring" />
    </div>
  );
}
