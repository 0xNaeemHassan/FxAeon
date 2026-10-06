'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import styles from './LeverageSplit.module.css';

/**
 * Leverage on f(x) Protocol as arithmetic: at L× the borrowed part of a
 * position (minted fxUSD for a long, borrowed wstETH or WBTC for a short) is
 * (L − 1) / L of it and the rest is the trader's share. Rows show 2×, 3×, and
 * the pool's current maximum, before fees. The bars fill once on screen.
 */
export function LeverageSplit({ max, debtLabel }: { max: number; debtLabel: string }) {
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
  const poolMax = Number.isFinite(max) && max > 1 ? Math.round(max * 10) / 10 : null;
  const rows = [2, 3, ...(poolMax !== null && poolMax > 3 ? [poolMax] : [])];
  return <ol ref={ref} className={styles.rows} aria-label={`Share of a position that is ${debtLabel}, by leverage, before fees`}>
    {rows.map((leverage) => {
      const borrowed = (leverage - 1) / leverage;
      const borrowedPercent = Math.round(borrowed * 100);
      const label = leverage === poolMax && leverage > 3 ? `${leverage.toFixed(1)}× · pool maximum` : `${leverage}×`;
      return <li key={leverage} className={styles.row} style={{ '--borrowed': borrowed } as CSSProperties}>
        <span className={styles.leverage}>{label}</span>
        <span className={styles.bar} aria-hidden="true"><i className={styles.borrowed} /><i className={styles.share} /></span>
        <span className={styles.figures}><b>{borrowedPercent}%</b> {debtLabel} · <b>{100 - borrowedPercent}%</b> yours</span>
      </li>;
    })}
  </ol>;
}
