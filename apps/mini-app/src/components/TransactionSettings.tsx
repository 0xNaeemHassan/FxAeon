'use client';

import { useEffect, useId, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { formatUnits } from 'viem';
import { ChevronRight } from 'lucide-react';
import { SettingsPopover } from '@/components/SettingsPopover';
import { fetchGasTierQuotes, type GasTierQuotes } from '@/lib/fx/gasFeePolicy';
import { usePrivyWallet } from '@/lib/wallet';
import { haptic } from '@/lib/telegram';
import {
  DEFAULT_GAS_TIER, DEFAULT_SLIPPAGE_PERCENT, GAS_TIERS, MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS, SETTINGS_KEY, SETTINGS_UPDATED_EVENT, SLIPPAGE_PRESETS_BPS,
  isSlippageBps, readGasTier, readSlippagePercent, writeTransactionSettings, type GasTier,
} from '@/lib/settings';
import styles from './TransactionSettings.module.css';

const SPEED_LABELS: Record<GasTier, string> = { standard: 'Standard', fast: 'Fast', rapid: 'Rapid' };
const DEFAULT_SLIPPAGE_BPS = Math.round(DEFAULT_SLIPPAGE_PERCENT * 100);
const percentNumber = (bps: number) => (bps / 100).toString();
const formatPercent = (bps: number) => `${percentNumber(bps)}%`;
const formatGwei = (wei: bigint) => {
  const gwei = Number(formatUnits(wei, 9));
  return `${gwei < 1 ? gwei.toFixed(3) : gwei < 10 ? gwei.toFixed(2) : gwei.toFixed(1)} gwei`;
};

function useStoredSettings() {
  const [bps, setBps] = useState(() => Math.round(readSlippagePercent() * 100));
  const [tier, setTier] = useState<GasTier>(readGasTier);
  useEffect(() => {
    const sync = (event: Event) => {
      if (event.type === 'storage' && (event as StorageEvent).key !== SETTINGS_KEY) return;
      setBps(Math.round(readSlippagePercent() * 100));
      setTier(readGasTier());
    };
    sync(new Event(SETTINGS_UPDATED_EVENT));
    window.addEventListener(SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(SETTINGS_UPDATED_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return { bps, tier };
}

/**
 * The one transaction-settings gear every action form carries, in the same
 * place: max slippage where a route converts assets, and network speed. It is
 * quiet at the defaults and shows a chip once something differs. Changes save
 * at once and reach every open form and review.
 */
export function TransactionSettings({ slippage = false }: { slippage?: boolean }) {
  const { bps, tier } = useStoredSettings();
  const summary = slippage ? `${formatPercent(bps)} slippage` : `${SPEED_LABELS[tier]} speed`;
  const changes = [
    slippage && bps !== DEFAULT_SLIPPAGE_BPS ? `${formatPercent(bps)} slippage` : null,
    tier !== DEFAULT_GAS_TIER ? SPEED_LABELS[tier] : null,
  ].filter(Boolean);
  return <SettingsPopover summary={summary} chip={changes.length ? changes.join(' · ') : null}>
    <TransactionSettingsPanel slippage={slippage} bps={bps} tier={tier} />
  </SettingsPopover>;
}

function TransactionSettingsPanel({ slippage, bps, tier }: { slippage: boolean; bps: number; tier: GasTier }) {
  const id = useId();
  const wallet = usePrivyWallet();
  // The field always shows the saved value; while focused it holds the draft.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [gas, setGas] = useState<GasTierQuotes | null>(null);
  const [gasStatus, setGasStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const presetIndex = (SLIPPAGE_PRESETS_BPS as readonly number[]).indexOf(bps);
  const walletSetsFees = Boolean(wallet.address) && !wallet.isEmbedded;

  useEffect(() => {
    let active = true;
    void fetchGasTierQuotes(1).then((quotes) => { if (active) { setGas(quotes); setGasStatus('ready'); } })
      .catch(() => { if (active) setGasStatus('unavailable'); });
    return () => { active = false; };
  }, []);

  const choosePreset = (value: number) => {
    haptic('selection');
    setDraft(null); setError('');
    writeTransactionSettings({ slippageBps: value });
  };
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim().replace(',', '.');
    setDraft(null);
    if (!text) { setError(''); return; }
    const value = Math.round(Number(text) * 100);
    if (!/^\d*\.?\d+$/.test(text) || !isSlippageBps(value) || Math.abs(Number(text) * 100 - value) > 1e-9) {
      setError(`Enter ${formatPercent(MIN_SLIPPAGE_BPS)} to ${formatPercent(MAX_SLIPPAGE_BPS)} in steps of 0.01%.`);
      return;
    }
    setError('');
    writeTransactionSettings({ slippageBps: value });
  };
  const chooseTier = (value: GasTier) => {
    haptic('selection');
    writeTransactionSettings({ gasTier: value });
  };

  return <div className={styles.panel}>
    {slippage && <section className={styles.section} aria-labelledby={`${id}-slippage`}>
      <div className={styles.heading}>
        <h3 id={`${id}-slippage`}>Max slippage</h3>
        <span className={styles.value}>{formatPercent(bps)}</span>
      </div>
      <p className={styles.help} id={`${id}-slippage-help`}>If the price moves more than this before confirmation, the transaction reverts instead of filling worse.</p>
      <div className={styles.choices} role="radiogroup" aria-labelledby={`${id}-slippage`} data-thumb={presetIndex >= 0 || undefined}
        style={{ '--seg-index': Math.max(presetIndex, 0), '--seg-count': SLIPPAGE_PRESETS_BPS.length } as CSSProperties}>
        {SLIPPAGE_PRESETS_BPS.map((value) => <button key={value} type="button" role="radio" aria-checked={bps === value}
          onClick={() => choosePreset(value)}>{formatPercent(value)}</button>)}
      </div>
      <label className={styles.custom} data-active={presetIndex < 0 || undefined} data-invalid={Boolean(error) || undefined}>
        <span>Custom</span>
        <input inputMode="decimal" autoComplete="off" value={draft ?? percentNumber(bps)} aria-label="Slippage tolerance percentage"
          aria-describedby={`${id}-slippage-help`} aria-invalid={Boolean(error)}
          onFocus={() => setDraft(percentNumber(bps))} onChange={(event) => { setDraft(event.target.value.slice(0, 6)); setError(''); }}
          onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } }} />
        <span aria-hidden="true">%</span>
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>}
    <section className={styles.section} aria-labelledby={`${id}-speed`}>
      <div className={styles.heading}>
        <h3 id={`${id}-speed`}>Network speed</h3>
        <span className={styles.value}>{SPEED_LABELS[tier]}</span>
      </div>
      <p className={styles.help}>{walletSetsFees
        ? 'Your connected wallet sets its own network fee. This applies to FxAeon’s built-in wallet.'
        : 'Faster speeds pay a higher priority fee so the transaction is included sooner.'}</p>
      <div className={styles.speeds} role="radiogroup" aria-labelledby={`${id}-speed`} data-thumb=""
        style={{ '--seg-index': GAS_TIERS.indexOf(tier), '--seg-count': GAS_TIERS.length } as CSSProperties}>
        {GAS_TIERS.map((value) => <button key={value} type="button" role="radio" aria-checked={tier === value} onClick={() => chooseTier(value)}>
          <span>{SPEED_LABELS[value]}</span>
          <small>{gas ? formatGwei(gas.tiers[value].gasPriceWei) : gasStatus === 'loading' ? <span className={`${styles.rateSkeleton} skeleton`} aria-label="Loading fee" /> : '—'}</small>
        </button>)}
      </div>
    </section>
    <Link href="/settings" className={styles.more}>All settings<ChevronRight aria-hidden="true" /></Link>
  </div>;
}
