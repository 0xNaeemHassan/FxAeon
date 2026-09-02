'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Activity, ChevronRight, RefreshCw, Settings, Wallet, X } from 'lucide-react';
import { formatUnits } from 'viem';
import TokenIcon from '@/components/TokenIcon';
import { AddressChip } from '@/components/ui';
import { useUsdPrices } from '@/components/PriceProvider';
import { readWalletBalances, type WalletBalancesResult, type WalletTokenBalance } from '@/lib/fx';
import { formatUsd, priceKeyForSymbol, usdValueForUnits } from '@/lib/prices';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';

export default function WalletProfile() {
  const wallet = usePrivyWallet();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState<WalletBalancesResult | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const { prices } = useUsdPrices();

  const load = useCallback(async () => {
    if (!wallet.address) return;
    setLoading(true);
    setError('');
    try {
      setBalances(await readWalletBalances(wallet.address));
    } catch {
      setBalances(null);
      setError('Wallet balances are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => {
    if (!open) return;
    void load();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', close);
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', close);
    };
  }, [load, open]);

  const nonZero = useMemo(() => balances?.balances.filter((balance) => balance.amountWei > 0n) ?? [], [balances]);
  const totalUsd = useMemo(() => nonZero.reduce((total, balance) => {
    const priceKey = priceKeyForSymbol(balance.key);
    const value = usdValueForUnits(balance.amountWei, balance.decimals, priceKey ? prices[priceKey] : undefined);
    return value === null ? total : total + value;
  }, 0), [nonZero, prices]);

  if (!wallet.ready) return <span className="h-11 w-11 animate-pulse rounded-xl bg-[var(--surface)]" aria-label="Loading wallet" />;
  if (!wallet.address) {
    return (
      <Link href="/login" className="glass-press flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-mint">
        <Wallet className="h-[18px] w-[18px]" aria-hidden="true" /> <span className="wallet-control-label">Connect</span>
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open wallet profile"
        onClick={() => { setOpen(true); haptic('light'); }}
        className="glass-press flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-[var(--text)]"
      >
        <Wallet className="h-[18px] w-[18px] text-mint" aria-hidden="true" />
        <span className="wallet-control-label">{wallet.address.slice(0, 5)}…{wallet.address.slice(-4)}</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="wallet-profile-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <aside role="dialog" aria-modal="true" aria-labelledby="wallet-profile-title" className="wallet-profile-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <header className="wallet-profile-header">
              <div>
                <p className="page-kicker">FxAeon account</p>
                <h2 id="wallet-profile-title" className="text-display mt-1 text-[22px] font-semibold">Wallet profile</h2>
              </div>
              <button ref={closeRef} type="button" aria-label="Close wallet profile" onClick={() => setOpen(false)} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--line)] text-mut"><X className="h-5 w-5" /></button>
            </header>

            <div className="wallet-profile-summary">
              <div className="flex items-center justify-between gap-3">
                <AddressChip address={wallet.address} />
                <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh wallet profile" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
              </div>
              <p className="mt-5 text-[12px] font-medium text-mut">Tracked wallet value</p>
              <p className="text-display mt-1 text-[38px] font-semibold tabular-nums">{nonZero.length && totalUsd > 0 ? formatUsd(totalUsd) : '—'}</p>
              <p className="mt-1 text-[11px] text-mut">Current supported assets · USD prices update every 30 seconds</p>
            </div>

            <div className="wallet-profile-assets" aria-label="Wallet assets">
              {loading && !balances && <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-2)]" />}
              {!loading && error && <p role="status" className="rounded-xl bg-[var(--warn-dim)] p-3 text-[12px] text-warn">{error}</p>}
              {!loading && balances && nonZero.length === 0 && <p className="p-3 text-[12px] text-mut">No supported balances found.</p>}
              {nonZero.map((balance) => {
                const priceKey = priceKeyForSymbol(balance.key);
                return <WalletAssetRow key={balance.key} balance={balance} price={priceKey ? prices[priceKey] : undefined} />;
              })}
            </div>

            <nav className="wallet-profile-links" aria-label="Wallet profile actions">
              <ProfileLink href="/activity" icon={Activity} label="Activity" body="Pending and confirmed wallet transactions" onNavigate={() => setOpen(false)} />
              <ProfileLink href="/settings" icon={Settings} label="Wallet settings" body="Change wallet, slippage, or sign out" onNavigate={() => setOpen(false)} />
            </nav>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

function WalletAssetRow({ balance, price }: { balance: WalletTokenBalance; price: number | undefined }) {
  const amount = formatUnits(balance.amountWei, balance.decimals);
  const usd = usdValueForUnits(balance.amountWei, balance.decimals, price);
  const label = balance.key === 'fxUSDBasePool' ? 'fxUSD base pool' : balance.key;
  return (
    <div className="flex min-h-[68px] items-center gap-3 border-b border-[var(--line)] py-3 last:border-b-0">
      <TokenIcon symbol={balance.key} size={34} />
      <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">{label}</p><p className="mt-0.5 truncate text-[11px] text-mut">{formatTokenAmount(amount)} {balance.key}</p></div>
      <div className="text-right"><p className="text-[14px] font-semibold tabular-nums">{formatUsd(usd)}</p><p className="mt-0.5 text-[10.5px] text-mut">{price ? `${formatUsd(price)} each` : 'Price unavailable'}</p></div>
    </div>
  );
}

function ProfileLink({ href, icon: Icon, label, body, onNavigate }: { href: string; icon: typeof Activity; label: string; body: string; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className="glass-press flex min-h-[66px] items-center gap-3 border-b border-[var(--line)] px-1 last:border-b-0">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><strong className="block text-[13px]">{label}</strong><span className="mt-0.5 block truncate text-[11px] text-mut">{body}</span></span>
      <ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
    </Link>
  );
}

function formatTokenAmount(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}
