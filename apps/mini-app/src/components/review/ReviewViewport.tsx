'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './ActionReviewPresentation.module.css';

/** Keep the decision and action in view; long quote/transaction details scroll inside. */
export function ReviewViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const navigation = document.querySelector<HTMLElement>('[data-fixed-navigation="true"]')?.getBoundingClientRect();
      const bottom = Math.min(viewportBottom, navigation && navigation.height > 0 ? navigation.top : viewportBottom);
      const parent = element.closest('.reviewInlineContent, .ui-card');
      const padding = parent ? Number.parseFloat(getComputedStyle(parent).paddingBottom) || 0 : 0;
      const top = Math.max(viewportTop, element.getBoundingClientRect().top);
      element.style.setProperty('--review-available-height', `${Math.max(0, bottom - top - padding - 12)}px`);
    };
    const onScroll = (event: Event) => {
      // Scrolling the bounded body does not change the card's available area.
      if (event.target instanceof Node && element.contains(event.target)) return;
      resize();
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    const shell = document.querySelector('.app-topbar');
    const observer = new ResizeObserver(resize);
    if (shell) observer.observe(shell);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);
  return <div ref={ref} data-review-viewport className={styles.reviewViewport}>{children}</div>;
}
