'use client';

import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useRef, type ReactNode } from 'react';
import { useLang } from '@/lib/i18n';

type Props = {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
};

/**
 * Scroll-triggered reveal with a hairline that draws itself before the
 * content settles in. Uses in-view state (not a scroll listener) so the
 * entrance fires once and stays cheap. Reduced motion renders the final
 * frame immediately, hairline included, with no animation at all.
 */
export function Reveal({ children, delay = 0, y = 20, className, as = 'div' }: Props) {
  const reduce = useReducedMotion();
  const { lang } = useLang();
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.14, margin: '0px 0px -8% 0px' });
  const Comp = motion[as];

  // A long, soft ease: the content arrives and settles rather than snapping.
  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <Comp
      ref={ref as never}
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      animate={reduce ? undefined : inView ? { opacity: 1, y: 0 } : undefined}
      transition={reduce ? { duration: 0 } : { duration: 0.8, delay, ease }}
    >
      {/* the drawing hairline — an instrument rule, not a decoration box */}
      <motion.span
        className="reveal-hairline"
        aria-hidden="true"
        style={{
          display: 'block',
          width: '100%',
          height: 1,
          marginBottom: 14,
          background: 'var(--line-soft)',
          transformOrigin: lang === 'ar' ? 'right center' : 'left center',
        }}
        initial={reduce ? false : { scaleX: 0, opacity: 0 }}
        animate={reduce ? undefined : inView ? { scaleX: 1, opacity: 1 } : undefined}
        transition={reduce ? { duration: 0 } : { duration: 1, delay: delay + 0.06, ease }}
      />
      {children}
    </Comp>
  );
}
