'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/* ------------------------------------------------------------------
   ArtRuntime — one shared observer for every `.rule-art` on the page,
   so pages only need the class to get a drawn hairline. Re-binds after
   client navigations. When motion is off it simply reveals the rules.
   ------------------------------------------------------------------ */
export function ArtRuntime() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const revealAll = () => {
      document.querySelectorAll('.rule-art').forEach((el) => el.setAttribute('data-drawn', 'true'));
    };

    const motionOff = () =>
      root.classList.contains('reduce-motion') ||
      root.dataset.art === 'off' ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (motionOff() || !('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).setAttribute('data-drawn', 'true');
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.05, rootMargin: '0px 0px -8% 0px' });

    const bind = () => {
      document.querySelectorAll<HTMLElement>('.rule-art:not([data-drawn])').forEach((el) => io.observe(el));
    };

    bind();
    const tick = window.setTimeout(bind, 0); // catch DOM committed by the route change
    return () => {
      window.clearTimeout(tick);
      io.disconnect();
    };
  }, [pathname]);

  return null;
}
