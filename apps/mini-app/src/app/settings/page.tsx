'use client';

import { useEffect, useId, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check } from 'lucide-react';
import { AppShell, Button, Skeleton } from '@/components/ui';
import { AccountSummary, SessionControl } from '@/components/AccountControls';
import AppearancePreference from '@/components/AppearancePreference';
import { Disclosure, PageHeading, ProductSurface } from '@/components/ProductUI';
import { useLocale } from '@/lib/i18n';
import { haptic } from '@/lib/telegram';
import { readSlippagePercent, SETTINGS_KEY } from '@/lib/settings';
import styles from '@/components/SettingsWorkspace.module.css';

const WalletSection = dynamic(() => import('@/components/WalletSection'), { ssr: false, loading: () => <Skeleton className="h-24" /> });
const PRESETS = [10, 50, 100, 200] as const;

export default function SettingsPage() {
  const { t } = useLocale();
  const [ready, setReady] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50);
  const [savedBps, setSavedBps] = useState(50);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const dirty = slippageBps !== savedBps;
  useEffect(() => {
    const value = Math.round(readSlippagePercent() * 100);
    setSlippageBps(value); setSavedBps(value); setReady(true);
  }, []);
  const select = (value: number) => { setSlippageBps(value); setSaved(false); setError(''); haptic('selection'); };
  const save = () => {
    if (!ready || !dirty) return;
    setError('');
    try {
      // Preserve appearance and any other independently managed preferences.
      let previous: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
      } catch { /* A corrupt old value can be replaced by the selected preference. */ }
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...previous, slippageBps }));
      setSavedBps(slippageBps); setSaved(true); haptic('success');
    } catch {
      setSaved(false);
      setError('This browser blocked local preference storage. Your changes have not been saved. Your wallet and onchain state were not affected.');
      haptic('error');
    }
  };
  return <AppShell>
    <div className={styles.workspace}>
      <PageHeading title={t('settings.title')} backHref="/more" />
      <section className={styles.section} aria-labelledby={`${id}-wallet`}>
        <h2 id={`${id}-wallet`}>Wallet</h2>
        <AccountSummary />
        <div className={styles.walletManagement}><Disclosure title="Change wallet"><WalletSection /></Disclosure></div>
      </section>
      <section className={styles.section} aria-labelledby={`${id}-preferences`}>
        <h2 id={`${id}-preferences`}>Transaction preferences</h2>
        <ProductSurface className={styles.panel}>
          <div className={styles.preferenceHeading}><h3 id={`${id}-slippage`}>Slippage tolerance</h3>
            <span className={saved ? styles.saved : undefined} role="status" aria-live="polite">{saved ? <><Check size={14} aria-hidden="true" />Saved</> : dirty ? 'Unsaved changes' : ''}</span>
          </div>
          <p id={`${id}-help`} className={styles.help}>Maximum adverse change from the quote.</p>
          <div className={styles.choices} role="radiogroup" aria-label={t('settings.maxSlippage')} aria-describedby={`${id}-help`}>
            {PRESETS.map((bps, index) => <button type="button" key={bps} role="radio" aria-checked={slippageBps === bps} disabled={!ready} tabIndex={slippageBps === bps ? 0 : -1}
              onClick={() => select(bps)} onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? PRESETS.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + PRESETS.length) % PRESETS.length;
                select(PRESETS[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}>{bps / 100}%</button>)}
          </div>
          <p className={styles.scope}>Trade, Positions and eligible fxSAVE actions. Saved on this device.</p>
          <Button onClick={save} disabled={!ready || !dirty} className={styles.save}>Save preferences</Button>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </ProductSurface>
      </section>
      <AppearancePreference />
      <SessionControl />
    </div>
  </AppShell>;
}
