// ============================================================
// LottieBox — tiny typed wrapper around lottie-web (v10.3).
// Loads a bundled Lottie JSON, loops it, and PAUSES immediately
// when the user prefers reduced motion (settings.ui.reduceMotion)
// — the animation system never fights accessibility.
// ============================================================
import { useEffect, useRef } from 'react';
import type { AnimationItem } from 'lottie-web';
import { useStore } from '../store';

export function LottieBox({
  data,
  size = 88,
  className,
  ariaLabel,
}: {
  /** Parsed Lottie JSON (imported asset). */
  data: unknown;
  /** Square render size in px. */
  size?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const reduceMotion = useStore((s) => s.settings.ui?.reduceMotion === true);

  useEffect(() => {
    let dead = false;
    let anim: AnimationItem | null = null;
    (async () => {
      const lottie = (await import('lottie-web')).default;
      if (dead || !hostRef.current) return;
      try {
        anim = lottie.loadAnimation({
          container: hostRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: !reduceMotion,
          animationData: JSON.parse(JSON.stringify(data)) as object,
        });
        animRef.current = anim;
        if (reduceMotion) anim.pause();
      } catch {
        /* malformed asset — the box simply stays empty */
      }
    })();
    return () => {
      dead = true;
      try {
        anim?.destroy();
      } catch {
        /* already gone */
      }
      animRef.current = null;
    };
  }, [data, reduceMotion]);

  // live toggle: pause/resume when the setting flips while mounted
  useEffect(() => {
    if (!animRef.current) return;
    try {
      if (reduceMotion) animRef.current.pause();
      else animRef.current.play();
    } catch {
      /* noop */
    }
  }, [reduceMotion]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel ?? 'animation'}
    />
  );
}

export default LottieBox;
