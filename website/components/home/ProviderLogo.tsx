'use client';

/* eslint-disable @next/next/no-img-element */
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

type Props = { slug: string; name: string; className?: string; index?: number };

/**
 * Shows a brand logo when the asset has shipped, and a clean text pill
 * otherwise — a missing file is never a broken image.
 *
 * The row is not a static grid: each mark settles onto a shallow orbital arc
 * (a tiny vertical offset driven by its index) and then breathes in place.
 * Reduced motion gets the settled, still frame with no timers or loops.
 */
export function ProviderLogo({ slug, name, className = '', index = 0 }: Props) {
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();

  // A shallow arc across the row: neighbours sit at slightly different heights.
  const arc = Math.sin(index * 0.78) * 2.6;
  const stagger = index * 0.07;

  const mark = failed ? (
    <span className={`trust-pill ${className}`}>{name}</span>
  ) : (
    <span className={`trust-logo ${className}`} title={name}>
      <img
        src={`/media/logos/${slug}.svg`}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );

  return (
    <motion.span
      className="trust-orbit"
      style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}
      initial={reduce ? false : { opacity: 0, y: 11, scale: 0.88, rotate: -2 }}
      animate={{ opacity: 1, y: arc, scale: 1, rotate: 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.9, delay: stagger, ease: [0.16, 1, 0.3, 1] }
      }
    >
      {/* inner layer keeps the slow orbit separate from the entrance so the
          settle lands cleanly before the drift begins */}
      <motion.span
        className="trust-orbit-inner"
        style={{ display: 'inline-flex', alignItems: 'center' }}
        animate={reduce ? undefined : { y: [arc, arc - 2.6, arc] }}
        transition={
          reduce
            ? undefined
            : {
                duration: 3.4 + (index % 4) * 0.35,
                delay: stagger,
                repeat: Infinity,
                repeatType: 'mirror',
                ease: 'easeInOut',
              }
        }
      >
        {mark}
      </motion.span>
      {/* the orbit node — a fine registration tick, not a border */}
      <motion.i
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -7,
          width: 1,
          height: 4,
          background: 'var(--line-strong)',
          transform: 'translateX(-50%)',
        }}
        initial={reduce ? false : { opacity: 0, scaleY: 0 }}
        animate={{ opacity: 0.7, scaleY: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.6, delay: stagger + 0.4 }}
      />
    </motion.span>
  );
}
