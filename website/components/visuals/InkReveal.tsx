'use client';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import './visuals.css';

/* ------------------------------------------------------------------
   InkReveal — opt-in scroll entrance, driven by IntersectionObserver.
   Stagger is expressed with the --i custom property on the element (or
   on each direct child when `stagger` is set): CSS turns it into a
   transition-delay. Two variants: 'rise' (ink lifting) and 'clip'
   (a plate-ink wipe). Content is visible without JS; the inline
   MOTION_INIT script in layout.tsx arms the hidden state pre-paint.
   ------------------------------------------------------------------ */
type RevealTag =
  | 'div' | 'section' | 'article' | 'span' | 'p' | 'li' | 'ul'
  | 'header' | 'footer' | 'h1' | 'h2' | 'h3' | 'h4'
  | 'figure' | 'figcaption' | 'blockquote' | 'aside';

export type InkRevealProps = {
  children?: ReactNode;
  as?: RevealTag;
  className?: string;
  style?: CSSProperties;
  /** stagger index → CSS `--i` */
  index?: number;
  /** extra delay in milliseconds */
  delay?: number;
  variant?: 'rise' | 'clip' | 'draw';
  /** animate direct children instead of the wrapper itself */
  stagger?: boolean;
  /** for variant="draw": show the traced crosshair frame (default true) */
  frame?: boolean;
  once?: boolean;
  threshold?: number;
};

export function InkReveal({
  children,
  as = 'div',
  className = '',
  style,
  index = 0,
  delay = 0,
  variant = 'rise',
  stagger = false,
  frame = true,
  once = true,
  threshold = 0.12,
}: InkRevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const root = document.documentElement;
    const motionOff = () =>
      root.classList.contains('reduce-motion') ||
      root.dataset.art === 'off' ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

  const Element: any = as; // intrinsic tag chosen by the caller
  const css = { ...(style || {}), '--i': index, '--ir-delay': `${delay}ms` } as CSSProperties;
  const drawFrame = variant === 'draw' && frame;

  return (
    <Element
      ref={ref}
      className={`ink-reveal ${className}`.trim()}
      data-in="false"
      data-stagger={stagger ? '' : undefined}
      data-variant={variant === 'clip' ? 'clip' : variant === 'draw' ? 'draw' : undefined}
      style={css}
    >
      {drawFrame && (
        <svg className="ir-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="ir-frame__line" d="M0 1H100" pathLength={1} style={{ '--i': 0 } as CSSProperties} />
          <path className="ir-frame__line" d="M100 0V100" pathLength={1} style={{ '--i': 1 } as CSSProperties} />
          <path className="ir-frame__line" d="M100 99H0" pathLength={1} style={{ '--i': 2 } as CSSProperties} />
          <path className="ir-frame__line" d="M0 100V0" pathLength={1} style={{ '--i': 3 } as CSSProperties} />
          <path className="ir-frame__cross" d="M50 43v5M50 52v5M43 50h5M52 50h5" />
        </svg>
      )}
      {children}
    </Element>
  );
}
