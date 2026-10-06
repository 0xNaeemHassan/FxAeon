'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef } from 'react';
import styles from './YieldFlow.module.css';

/**
 * Where fxSAVE's yield comes from, drawn as the landing draws it: three
 * documented sources stream into f(x) Protocol's stability pool, and fxSAVE
 * compounds what the pool earns. Text is real text; the streams are
 * decoration and run only while the figure is on screen and motion is welcome.
 */
export function YieldFlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => node.toggleAttribute('data-live', entry.isIntersecting), { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={styles.flow}>
    <ul className={styles.sources} aria-label="Sources of stability pool rewards">
      <li><span className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 5v4" /><rect width="4" height="6" x="7" y="9" rx="1" /><path d="M9 15v2M17 3v2" /><rect width="4" height="8" x="15" y="5" rx="1" /><path d="M17 13v3M3 3v16a2 2 0 0 0 2 2h16" /></svg></span>Position fees</li>
      <li><span className={styles.icon} aria-hidden="true"><img src="/token-icons/wsteth.png" alt="" width={22} height={22} /></span>wstETH staking</li>
      <li><span className={styles.icon} aria-hidden="true"><img src="/token-icons/usdc.png" alt="" width={22} height={22} /></span>USDC lending</li>
    </ul>
    <svg className={styles.links} viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true">
      <path className={styles.path} d="M0 20C55 20 45 60 100 60" />
      <path className={styles.path} d="M0 60H100" />
      <path className={styles.path} d="M0 100C55 100 45 60 100 60" />
      <path className={styles.run} pathLength={1} d="M0 20C55 20 45 60 100 60" />
      <path className={`${styles.run} ${styles.second}`} pathLength={1} d="M0 60H100" />
      <path className={`${styles.run} ${styles.third}`} pathLength={1} d="M0 100C55 100 45 60 100 60" />
    </svg>
    <p className={styles.pool}><strong>Stability pool</strong><small>fxUSD + USDC</small></p>
    <svg className={styles.out} viewBox="0 0 40 20" preserveAspectRatio="none" aria-hidden="true">
      <path className={`${styles.path} ${styles.outPath}`} d="M0 10H40" />
      <path className={`${styles.run} ${styles.outRun}`} pathLength={1} d="M0 10H40" />
    </svg>
    <p className={styles.save}><img src="/token-icons/fxsave.svg" alt="" width={34} height={34} /><strong>fxSAVE</strong></p>
  </div>;
}
