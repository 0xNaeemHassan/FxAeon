'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * On phones a primary action never rests behind the tab bar: it keeps its place
 * in the form whenever that place is on screen, and otherwise rides just above
 * the navigation. A sentinel after it reports when it is riding, so the canvas
 * fade behind it appears only then and never covers content below a resting action.
 */
export function StickyAction({ children, className = '' }: { children: ReactNode; className?: string }) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [riding, setRiding] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      // The visible area ends where the tab bar's panel begins; without a tab bar it is the viewport.
      const panel = document.querySelector('nav.mobile-tabbar > *');
      const covered = panel && getComputedStyle(panel).display !== 'none' ? Math.max(0, window.innerHeight - panel.getBoundingClientRect().top) : 0;
      observer = new IntersectionObserver(([entry]) => {
        // Riding: the natural place is below the visible area, not scrolled past above it.
        setRiding(!entry.isIntersecting && entry.boundingClientRect.top > 0);
      }, { rootMargin: `0px 0px -${Math.round(covered)}px 0px` });
      observer.observe(sentinel);
    };
    observe();
    window.addEventListener('resize', observe);
    return () => { window.removeEventListener('resize', observe); observer?.disconnect(); };
  }, []);

  return <>
    <div className={`sticky-action ${className}`.trim()} data-riding={riding || undefined}>{children}</div>
    <span ref={sentinelRef} className="sticky-action-sentinel" aria-hidden="true" />
  </>;
}
