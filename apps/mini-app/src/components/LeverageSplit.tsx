'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import styles from './LeverageSplit.module.css';

/**
 * Debt as a share of collateral value, before fees. A displayed L× long has
 * collateral/equity = L, so debt/collateral = (L − 1) / L. A displayed L×
 * short has debt/equity = L, so debt/collateral = L / (L + 1). The remainder
 * is the trader's share. Both directions show the same 2× and 3× rows, so
 * comparing them never changes the layout; the pool's live range is Trade's
 * Leverage stat. These are educational examples, not position valuations or
 * SDK inputs. The bars fill once on screen.
 */
const EXAMPLE_LEVERAGES = [2, 3] as const;

export function LeverageSplit({ side, debtLabel }: { side: 'long' | 'short'; debtLabel: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') { node.toggleAttribute('data-shown', true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      node.toggleAttribute('data-shown', true);
      observer.disconnect();
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <ol ref={ref} className={styles.rows} aria-label={`Share of a position that is ${debtLabel}, by leverage, before fees`}>
    {EXAMPLE_LEVERAGES.map((leverage) => {
      const borrowed = side === 'short' ? leverage / (leverage + 1) : (leverage - 1) / leverage;
      const borrowedPercent = Math.round(borrowed * 100);
      return <li key={leverage} className={styles.row} style={{ '--borrowed': borrowed } as CSSProperties}>
        <span className={styles.leverage}>{leverage}×</span>
        <span className={styles.bar} aria-hidden="true"><i className={styles.borrowed} /><i className={styles.share} /></span>
        <span className={styles.figures}><b>{borrowedPercent}%</b> {debtLabel} · <b>{100 - borrowedPercent}%</b> yours</span>
      </li>;
    })}
  </ol>;
}
