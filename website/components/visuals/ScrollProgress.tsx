'use client';
import { useEffect, useRef } from 'react';

/* ------------------------------------------------------------------
   ScrollProgress — a 1px instrument hairline across the very top.
   Writes straight to the DOM (no React state on scroll): a CSS var
   --p drives the fill + leading tick, the mono readout shows percent
   only on large screens. Decorative, aria-hidden, kill-switchable.
   ------------------------------------------------------------------ */
export function ScrollProgress() {
  const rootRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      root.style.setProperty('--p', p.toFixed(4));
      if (numRef.current) numRef.current.textContent = String(Math.round(p * 100)).padStart(2, '0');
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(paint); };

    paint();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
    };
  }, []);

  return (
    <div ref={rootRef} className="art-progress" aria-hidden="true">
      <span className="art-progress__track" />
      <span className="art-progress__fill" />
      <span className="art-progress__head" />
      <span ref={numRef} className="art-progress__pct">00</span>
    </div>
  );
}
