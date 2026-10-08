'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { debtShare, splitPercents, type LeverageSide } from '@/lib/leverageShare';
import styles from './LeverageSplit.module.css';

/**
 * Leverage as a split of collateral (see debtShare): the debt beside the
 * trader's share. Both directions show the same 2× and 3× rows, so comparing
 * them never changes the layout; the pool's live range is Trade's Leverage
 * stat. These are educational examples, not position valuations or SDK
 * inputs. The bars fill once on screen.
 */
const EXAMPLE_LEVERAGES = [2, 3] as const;

export function LeverageSplit({ side, debtLabel }: { side: LeverageSide; debtLabel: string }) {
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
      const { debt, yours } = splitPercents(side, leverage);
      return <li key={leverage} className={styles.row} style={{ '--borrowed': debtShare(side, leverage) } as CSSProperties}>
        <span className={styles.leverage}>{leverage}×</span>
        <span className={styles.bar} aria-hidden="true"><i className={styles.borrowed} /><i className={styles.share} /></span>
        <span className={styles.figures}><b>{debt}%</b> {debtLabel} · <b>{yours}%</b> yours</span>
      </li>;
    })}
  </ol>;
}

/**
 * The same split at the leverage being chosen, for the ticket's slider. It
 * answers every move of the thumb; outside the live range it stays empty so
 * the row never changes height.
 */
export function LeverageSplitCaption({ id, side, debtLabel, leverage, min, max }: {
  id: string; side: LeverageSide; debtLabel: string; leverage: number; min: number; max: number;
}) {
  const inRange = Number.isFinite(leverage) && leverage >= min && leverage <= max;
  const { debt, yours } = splitPercents(side, leverage);
  return <span id={id} className={styles.caption} data-empty={inRange ? undefined : true}>
    {inRange && <><b>{debt}%</b> {debtLabel} · <b>{yours}%</b> yours<span className="sr-only"> at {leverage.toFixed(1)}×, before fees</span></>}
  </span>;
}
