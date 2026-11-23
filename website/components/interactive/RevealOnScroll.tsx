'use client';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './InteractiveArt.css';

/* ------------------------------------------------------------------
   RevealOnScroll — one-shot, elegant section entrance: a 1px hairline
   draws across the top edge while the content fades up. IntersectionObserver
   does the work; the hidden state is armed pre-paint by the site's existing
   MOTION_INIT inline script (html[data-js='1'] in app/layout.tsx), so SSR is
   untouched — content is fully visible with JS disabled.

   Reduced motion (OS preference, .reduce-motion or data-art='off') resolves
   instantly to the static end state: hairline drawn, content in place.
   ------------------------------------------------------------------ */

type RevealTag =
  | 'div' | 'section' | 'article' | 'aside' | 'header' | 'footer'
  | 'figure' | 'ul' | 'ol' | 'li' | 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4';

export type RevealOnScrollProps = {
  children?: ReactNode;
  as?: RevealTag;
  className?: string;
  style?: CSSProperties;
  /** cascade index → CSS --i (default 0) */
  index?: number;
  /** extra delay in milliseconds → CSS --ir-delay */
  delay?: number;
  /** IntersectionObserver visibility threshold (default 0.12) */
  threshold?: number;
  /** unobserve after the first reveal (default true) */
  once?: boolean;
  /** draw the entering 1px hairline (default true) */
  rule?: boolean;
};

export function RevealOnScroll({
  children,
  as = 'div',
  className = '',
  style,
  index = 0,
  delay = 0,
  threshold = 0.12,
  once = true,
  rule = true,
}: RevealOnScrollProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const root = document.documentElement;
    const mm = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const motionOff = () =>
      root.classList.contains('reduce-motion') ||
      root.dataset.art === 'off' ||
      (mm ? mm.matches : false);

    if (motionOff() || !('IntersectionObserver' in window)) {
      el.setAttribute('data-in', 'true');
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          el.setAttribute('data-in', 'true');
          if (once) io.unobserve(el);
        } else if (!once) {
          el.setAttribute('data-in', 'false');
        }
      }
    }, { threshold, rootMargin: '0px 0px -6% 0px' });

    io.observe(el);
    return () => io.disconnect();
  }, [once, threshold]);

  const Element: any = as; // caller chooses the semantic tag
  const css = { ...(style || {}), '--i': index, '--ir-delay': `${delay}ms` } as CSSProperties;

  return (
    <Element
      ref={ref}
      className={`ia-reveal ${className}`.trim()}
      data-in="false"
      data-rule={rule ? '' : undefined}
      style={css}
    >
      {rule && <span className="ia-reveal__rule" aria-hidden="true" />}
      {children}
    </Element>
  );
}
