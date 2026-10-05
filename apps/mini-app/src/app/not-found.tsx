import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FxLogo } from '@/components/FxLogo';
import styles from '@/components/UtilitySurfaces.module.css';

export default function NotFound() {
  return (
    <main className={`app-shell ${styles.authStage} mx-auto w-full max-w-[430px]`}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 className={styles.authTitle}>This screen is outside FxAeon</h1>
      <p className={styles.authLead}>That page is not available here. Return to your portfolio to continue.</p>
      <div className={styles.authActions}>
        <Link href="/" className="button button-primary glass-press flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 text-[15px] font-semibold">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to portfolio
        </Link>
      </div>
    </main>
  );
}
