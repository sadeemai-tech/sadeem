'use client';
import { usePathname } from 'next/navigation';

/* ------------------------------------------------------------------
   PageCurtain — a single 2px ink sweep on route change (and on first
   mount). Keying the node on the pathname restarts the CSS animation
   with no JS motion loop; App Router keeps the layout a Server
   Component. Reduced motion / kill switches remove it in CSS.
   ------------------------------------------------------------------ */
export function PageCurtain() {
  const pathname = usePathname();
  return (
    <div className="art-curtain" key={pathname} aria-hidden="true">
      <span />
    </div>
  );
}
