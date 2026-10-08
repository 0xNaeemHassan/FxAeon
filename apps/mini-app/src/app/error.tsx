'use client';

import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { FxLogo } from '@/components/FxLogo';
import styles from '@/components/UtilitySurfaces.module.css';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error('FxAeon route error', error);
  }, [error]);
  // Plain links reload the app, which a screen that failed to draw may need.
  return (
    <main className={`${styles.authStage} utility-stage mx-auto w-full max-w-[460px]`}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 className={styles.authTitle}>This screen could not load</h1>
      <p className={styles.authLead}>Try again to reload it. If you started a wallet action, check History first so nothing is sent twice.</p>
      <div className={styles.authActions}>
        <button type="button" onClick={reset} className="button button-primary glass-press flex min-h-12 w-full items-center justify-center px-4 py-3 font-semibold">Try again</button>
        <a href="/history" className="button button-ghost glass-press flex min-h-12 w-full items-center justify-center px-4 py-3 font-semibold">Open History</a>
      </div>
      <a href="/" className={styles.authBack}><ArrowLeft aria-hidden="true" />Back to Portfolio</a>
    </main>
  );
}
