'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Activity, ChevronRight, ExternalLink, LogOut, RefreshCw, Settings, Wallet, X, type LucideIcon } from 'lucide-react';
import { formatUnits } from 'viem';
import TokenIcon from '@/components/TokenIcon';
import { AddressChip } from '@/components/ui';
import { useUsdPrices } from '@/components/PriceProvider';
import { useWalletBalances } from '@/components/WalletDataProvider';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import type { WalletBalancesResult, WalletTokenBalance } from '@/lib/fx';
import { formatUsd, priceKeyForSymbol, usdValueForUnits } from '@/lib/prices';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/app/AccountWorkspace.module.css';
import ConnectWalletButton from '@/components/ConnectWalletButton';

export default function WalletProfile() {
  const wallet = usePrivyWallet();
  const positionState = useProtocolPositions();
  const refreshPositions = positionState.refresh;
  const walletIdentity = wallet.ready && wallet.authenticated ? wallet.address?.toLowerCase() ?? '' : '';
  const [openWallet, setOpenWallet] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  // Hide immediately on account loss/change, then discard the old open state
  // so reconnecting that account cannot silently reopen a prior drawer.
  const open = Boolean(walletIdentity && openWallet === walletIdentity);
  useEffect(() => { setOpenWallet(null); }, [walletIdentity]);
  const walletBalances = useWalletBalances({ address: wallet.address, chainId: 1, enabled: open && wallet.ready && Boolean(wallet.address) });
  const balances = walletBalances.data;
  const loading = walletBalances.status === 'loading';
  const refreshingBalances = walletBalances.isFetching;
  const error = walletBalances.status === 'unavailable' ? 'Wallet balances are temporarily unavailable.' : '';
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { prices, status: priceStatus, refreshing: pricesRefreshing } = useUsdPrices();

  useEffect(() => {
    if (open && wallet.ready && wallet.address) {
      void refreshPositions();
    }
  }, [open, refreshPositions, wallet.address, wallet.ready]);

  useEffect(() => {
    if (!open) return;
    const restoreFocusTo = openerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenWallet(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      window.requestAnimationFrame(() => restoreFocusTo?.focus());
    };
  }, [open]);

  const nonZero = useMemo(() => balances?.balances.filter((balance) => balance.amountWei > 0n) ?? [], [balances]);
  const valuation = useMemo(() => walletValuation(balances, prices), [balances, prices]);

  const disconnect = async () => {
    setDisconnectError('');
    setDisconnecting(true);
    try {
      await wallet.disconnect();
      setOpenWallet(null);
      haptic('success');
    } catch (cause) {
      setDisconnectError(userSafeError(cause, 'Wallet disconnect is temporarily unavailable.'));
      haptic('error');
    } finally {
      setDisconnecting(false);
    }
  };

  if (!wallet.ready) return <span role="status" className="h-11 w-11 animate-pulse rounded-xl bg-[var(--surface)]"><span className="sr-only">Loading wallet</span></span>;
  if (!wallet.address) {
    return (
      <ConnectWalletButton aria-label="Connect wallet" className={`${styles.walletConnect} glass-press`}>
        <Wallet className="h-[18px] w-[18px]" aria-hidden="true" /> <span className="wallet-control-label">Connect</span>
      </ConnectWalletButton>
    );
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-label="Open wallet profile"
        onClick={() => { setOpenWallet(walletIdentity); haptic('light'); }}
        className={`${styles.walletTrigger} glass-press flex items-center gap-2 text-[12px] font-semibold`}
      >
        <Wallet className="h-[18px] w-[18px] text-mint" aria-hidden="true" />
        <span className="wallet-control-label">{wallet.address.slice(0, 5)}…{wallet.address.slice(-4)}</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className={`${styles.walletBackdrop} wallet-profile-backdrop`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenWallet(null); }}>
          <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="wallet-profile-title" className={`${styles.walletSheet} wallet-profile-sheet`} onMouseDown={(event) => event.stopPropagation()}>
            <header className={`${styles.walletHeader} wallet-profile-header`}>
              <div>
                <p className={styles.eyebrow}>FxAeon account</p>
                <h2 id="wallet-profile-title" className="text-display mt-1 text-[22px] font-semibold">Wallet profile</h2>
              </div>
              <button ref={closeRef} type="button" aria-label="Close wallet profile" onClick={() => setOpenWallet(null)} className={`${styles.walletIconAction} glass-press`}><X className="h-5 w-5" aria-hidden="true" /></button>
            </header>

            <div className={`${styles.walletSummary} wallet-profile-summary`}>
              <div className="flex items-center justify-between gap-3">
                <AddressChip address={wallet.address} />
                <div className="flex items-center gap-1">
                  <a href={`https://etherscan.io/address/${wallet.address}`} target="_blank" rel="noopener noreferrer" aria-label="View wallet on Etherscan" className={`${styles.walletIconAction} glass-press`}><ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
                  <button type="button" onClick={() => void Promise.allSettled([walletBalances.refresh(), refreshPositions()])} disabled={refreshingBalances || positionState.refreshing} aria-label="Refresh wallet profile" className={`${styles.walletIconAction} glass-press`}><RefreshCw className={`h-4 w-4 ${refreshingBalances || positionState.refreshing ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
                </div>
              </div>
              <p className="mt-5 text-[12px] font-medium text-mut">Tracked wallet value</p>
              <p className="text-display mt-1 text-[38px] font-semibold tabular-nums">{!loading && valuation.complete ? formatUsd(valuation.totalUsd) : '—'}</p>
              <p className={`mt-1 text-[11px] ${!loading && !valuation.complete ? 'text-warn' : 'text-mut'}`} aria-live="polite">
                {loading ? 'Reading supported balances…' : valuation.reason || 'Complete supported-asset total · USD prices update every 30 seconds'}
              </p>
              <button type="button" onClick={() => void disconnect()} disabled={disconnecting} className="button glass-press mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[rgba(255,90,95,0.28)] bg-[rgba(255,90,95,0.1)] px-4 text-[13px] font-semibold text-danger disabled:opacity-60">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {disconnecting ? 'Disconnecting…' : 'Disconnect wallet'}
              </button>
              {disconnectError && <p role="alert" className="mt-2 rounded-xl bg-[var(--danger-dim)] p-3 text-[12px] text-danger">{disconnectError}</p>}
            </div>

            <section className={`${styles.walletSection} wallet-profile-assets`} aria-labelledby="wallet-profile-positions-title">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><p className={styles.eyebrow}>f(x) protocol</p><h3 id="wallet-profile-positions-title" className="mt-1 text-[15px] font-semibold">Open positions</h3></div>
                <Link href="/positions" onClick={() => setOpenWallet(null)} className="glass-press inline-flex min-h-11 items-center gap-1 px-1 text-[11px] font-semibold text-mint">{positionState.positions.length > 2 ? `View all ${positionState.positions.length}` : 'Manage'} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
              </div>
              <div className="flex flex-col gap-2">
                <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing} onRefresh={() => void refreshPositions()} compact />
                <ConfirmedPositionCards />
                {positionState.status === 'loading' && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton compact /> : positionState.positions.length > 0 ? (
                  positionState.positions.slice(0, 2).map((position) => <ProtocolPositionCard key={`${position.market}:${position.side}:${position.info.positionId}`} position={position} compact href="/positions" onNavigate={() => setOpenWallet(null)} stale={positionIsStale(position, positionState.failedGroups)} />)
                ) : positionState.status === 'ready' && !positionState.pendingPositions.length ? <p className="rounded-xl border border-[var(--line)] p-3 text-[12px] text-mut">No open protocol positions.</p> : null}
              </div>
            </section>

            <div className={`${styles.walletSection} ${styles.walletAssets} wallet-profile-assets`} aria-label="Wallet assets">
              {loading && !balances && <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-2)]" />}
              {refreshingBalances && balances && <p role="status" className="text-[11px] text-mut">Refreshing · showing last verified asset balances.</p>}
              {!loading && error && <p role="status" className="rounded-xl bg-[var(--warn-dim)] p-3 text-[12px] text-warn">{error}</p>}
              {!loading && balances && nonZero.length === 0 && <p className="p-3 text-[12px] text-mut">{balances.failedTokens.length > 0 ? 'No positive balances in the assets verified so far.' : 'No supported balances found.'}</p>}
              {nonZero.map((balance) => {
                const priceKey = priceKeyForSymbol(balance.key);
                return <WalletAssetRow key={balance.key} balance={balance} price={priceKey ? prices[priceKey] : undefined} pricePending={priceStatus === 'loading' || pricesRefreshing} />;
              })}
              {!loading && balances && balances.failedTokens.length > 0 && (
                <p role="status" className="rounded-xl bg-[var(--warn-dim)] p-3 text-[12px] text-warn">Some supported balance reads failed. Asset rows may be incomplete, so no wallet total is shown.</p>
              )}
            </div>

            <nav className={`${styles.walletSection} ${styles.walletLinks} wallet-profile-links`} aria-label="Wallet profile actions">
              <ProfileLink href="/activity" icon={Activity} label="Activity" body="This device's journal, checked against chain receipts" onNavigate={() => setOpenWallet(null)} />
              <ProfileLink href="/settings" icon={Settings} label="Wallet settings" body="Change wallet, slippage, or sign out" onNavigate={() => setOpenWallet(null)} />
            </nav>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

function WalletAssetRow({ balance, price, pricePending }: { balance: WalletTokenBalance; price: number | undefined; pricePending: boolean }) {
  const amount = formatUnits(balance.amountWei, balance.decimals);
  const usd = usdValueForUnits(balance.amountWei, balance.decimals, price);
  const label = balance.key === 'fxUSDBasePool' ? 'fxUSD pool token' : balance.key;
  return (
    <div className={`${styles.walletAssetRow} flex items-center gap-3 border-b border-[var(--line)] py-3 last:border-b-0`}>
      <TokenIcon symbol={balance.key} size={34} />
      <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">{label}</p><p className="mt-0.5 truncate text-[11px] text-mut">{formatTokenAmount(amount)} {balance.key}</p></div>
      <div className="text-right"><p className="text-[14px] font-semibold tabular-nums">{formatUsd(usd)}</p><p className="mt-0.5 text-[10.5px] text-mut">{price ? formatUsd(price) : pricePending ? 'Value loading…' : 'Price delayed · retrying'}</p></div>
    </div>
  );
}

function ProfileLink({ href, icon: Icon, label, body, onNavigate }: { href: string; icon: LucideIcon; label: string; body: string; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className={`${styles.walletLink} glass-press flex items-center gap-3 border-b border-[var(--line)] px-1 last:border-b-0`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><strong className="block text-[13px]">{label}</strong><span className="mt-0.5 block truncate text-[11px] text-mut">{body}</span></span>
      <ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
    </Link>
  );
}

type WalletValuation = {
  complete: boolean;
  totalUsd: number | null;
  reason: string;
};

function walletValuation(balances: WalletBalancesResult | null, prices: ReturnType<typeof useUsdPrices>['prices']): WalletValuation {
  if (!balances) return { complete: false, totalUsd: null, reason: 'Supported balances are unavailable.' };
  if (balances.failedTokens.length > 0) {
    return { complete: false, totalUsd: null, reason: 'Some supported balances could not be verified, so the total is hidden.' };
  }
  const held = balances.balances.filter((balance) => balance.amountWei > 0n);
  const values = held.map((balance) => {
    const priceKey = priceKeyForSymbol(balance.key);
    return usdValueForUnits(balance.amountWei, balance.decimals, priceKey ? prices[priceKey] : undefined);
  });
  if (values.some((value) => value === null)) {
    return { complete: false, totalUsd: null, reason: 'A validated USD price is missing for a held asset, so the total is hidden.' };
  }
  return {
    complete: true,
    totalUsd: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    reason: '',
  };
}

function formatTokenAmount(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
