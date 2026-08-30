'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  CandlestickChart,
  ChevronRight,
  Layers2,
  PiggyBank,
  QrCode,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { formatUnits } from 'viem';
import { AppShell, ActionTile, AddressChip, Card, EmptyState, SectionTitle } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import { assertConfiguredPublicClientChain, getFxSdk } from '@/lib/fx';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import PendingTransactionRecovery from '@/components/PendingTransactionRecovery';

/**
 * Portfolio is a navigation and trust surface, not a second accounting
 * system. Positions, fxSAVE state, and balances are rendered by their
 * official SDK-backed pages; this screen never estimates USD value, PnL, or
 * market prices from a generic API.
 */
export default function PortfolioPage() {
  return (
    <AppShell tabs>
      <div className="stagger flex flex-col">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-mut">Ethereum · Base</p>
            <h1 className="text-display text-[26px] font-semibold leading-tight">Portfolio</h1>
          </div>
          <Link href="/settings" onClick={() => haptic('light')} aria-label="Open wallet settings" className="glass-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)]">
            <Wallet className="h-5 w-5 text-mint" aria-hidden="true" />
          </Link>
        </header>

        {privyConfigured() ? <PortfolioWallet /> : <WalletUnavailable />}

        <SectionTitle>Actions</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <ActionTile icon={QrCode} label="Receive" hint="Fund wallet" href="/qr" />
          <ActionTile icon={CandlestickChart} label="Trade" hint="Open a position" href="/trade" />
          <ActionTile icon={Layers2} label="Positions" hint="Manage exposure" href="/positions" />
          <ActionTile icon={PiggyBank} label="fxSAVE" hint="Deposit or redeem" href="/earn" />
          <ActionTile icon={ArrowLeftRight} label="Move" hint="Ethereum ↔ Base" href="/move" />
          <ActionTile icon={Banknote} label="Borrow" hint="Mint or repay" href="/borrow" />
        </div>
      </div>
    </AppShell>
  );
}

function PortfolioWallet() {
  const { ready, authenticated } = usePrivy();
  const walletState = usePrivyWallet();
  const wallet = walletState.selectedWallet;
  const [refreshed, setRefreshed] = useState(false);
  const walletTimedOut = useWalletReadyTimeout(ready && walletState.ready);
  const [protocol, setProtocol] = useState<ProtocolSnapshot>({ status: 'idle', positions: null, fxSaveShares: null, fxSaveAssets: null, redeemReady: null });

  const loadProtocol = useCallback(async () => {
    if (!wallet?.address) return;
    setProtocol((current) => ({ ...current, status: 'loading' }));
    try {
      await assertConfiguredPublicClientChain(1);
      const sdk = getFxSdk();
      const [positions, fxSave, redeem] = await Promise.allSettled([
        Promise.all([
          sdk.getPositions({ userAddress: wallet.address, market: 'ETH', type: 'long' }),
          sdk.getPositions({ userAddress: wallet.address, market: 'ETH', type: 'short' }),
          sdk.getPositions({ userAddress: wallet.address, market: 'BTC', type: 'long' }),
          sdk.getPositions({ userAddress: wallet.address, market: 'BTC', type: 'short' }),
        ]),
        sdk.getFxSaveBalance({ userAddress: wallet.address }),
        sdk.getFxSaveClaimable({ userAddress: wallet.address }),
      ]);
      const fulfilled = [positions, fxSave, redeem].filter((result) => result.status === 'fulfilled').length;
      setProtocol({
        status: fulfilled === 3 ? 'ready' : fulfilled > 0 ? 'partial' : 'unavailable',
        positions: positions.status === 'fulfilled'
          ? positions.value.reduce((total, marketPositions) => total + marketPositions.length, 0)
          : null,
        fxSaveShares: fxSave.status === 'fulfilled' ? formatProtocolAmount(fxSave.value.balanceWei) : null,
        fxSaveAssets: fxSave.status === 'fulfilled' && fxSave.value.assetsWei !== undefined ? formatProtocolAmount(fxSave.value.assetsWei) : null,
        redeemReady: redeem.status === 'fulfilled' ? redeem.value.isCooldownComplete : null,
      });
    } catch {
      setProtocol({ status: 'unavailable', positions: null, fxSaveShares: null, fxSaveAssets: null, redeemReady: null });
    }
  }, [wallet?.address]);

  useEffect(() => {
    if (authenticated && wallet?.address && walletState.ready) void loadProtocol();
  }, [authenticated, loadProtocol, wallet?.address, walletState.ready]);

  if (!ready || !walletState.ready) {
    if (walletTimedOut) {
       return <EmptyState icon={RefreshCw} title="Wallet did not load" body="Check your connection, update Telegram, or reopen FxAeon." action={<button type="button" onClick={() => window.location.reload()} className="button button-primary min-h-11 w-full rounded-xl px-4">Reload wallet</button>} />;
    }
    return <Card className="h-36 animate-pulse"><span className="sr-only">Loading wallet</span></Card>;
  }

  if (!authenticated || !wallet) {
    return (
      <Card glow className="relative overflow-hidden p-5">
        <div className="relative">
          <h2 className="text-display text-[21px] font-semibold">{authenticated ? 'Choose a wallet' : 'Connect your wallet'}</h2>
          <p className="mt-2 max-w-[310px] text-[13px] leading-relaxed text-mut">View your positions, fxSAVE balance, and pending transactions.</p>
          <Link href="/login" className="button button-primary glass-press mt-5 flex min-h-12 w-full max-w-[240px] items-center justify-center rounded-xl px-4 py-3 text-[15px] font-semibold">{authenticated ? 'Choose wallet' : 'Connect wallet'}</Link>
        </div>
      </Card>
    );
  }

  return (
    <>
    <Card className="relative overflow-hidden p-4">
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-mut">Wallet</p>
            <div className="mt-2"><AddressChip address={wallet.address} /></div>
          </div>
          <button
            type="button"
            aria-label="Refresh on-chain views"
            onClick={() => {
              haptic('light');
              setRefreshed(true);
              void loadProtocol();
              window.setTimeout(() => setRefreshed(false), 1200);
            }}
            className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut hover:text-mint"
          >
            <RefreshCw className={`h-4 w-4 ${refreshed ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          <Link href="/positions" onClick={() => haptic('light')} className="glass-press flex min-h-[64px] items-center justify-between py-3">
            <span><span className="block text-[13px] font-semibold">Positions</span><span className="mt-0.5 block text-[12px] text-mut">{protocol.positions !== null ? `${protocol.positions} open` : protocol.status === 'loading' ? 'Loading…' : 'Unavailable'}</span></span><ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
          </Link>
          <Link href="/earn" onClick={() => haptic('light')} className="glass-press flex min-h-[64px] items-center justify-between py-3">
            <span><span className="block text-[13px] font-semibold">fxSAVE</span><span className="mt-0.5 block text-[12px] text-mut">{protocol.fxSaveAssets !== null ? `${protocol.fxSaveAssets} fxUSD` : protocol.fxSaveShares !== null ? `${protocol.fxSaveShares} shares` : protocol.status === 'loading' ? 'Loading…' : 'Unavailable'}</span></span><ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
          </Link>
        </div>
        {(protocol.status === 'ready' || protocol.status === 'partial') && protocol.redeemReady === true && (
          <Link href="/earn" onClick={() => haptic('light')} className="mt-3 flex min-h-11 items-center justify-between rounded-xl bg-[var(--success-dim)] px-3 py-2 text-[12px] font-semibold text-success">fxSAVE ready to claim <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
        )}
        {(protocol.status === 'unavailable' || protocol.status === 'partial') && (
          <p role="status" className="mt-3 rounded-xl bg-[var(--warn-dim)] px-3 py-2 text-[11px] leading-relaxed text-warn">{protocol.status === 'partial' ? 'Some on-chain reads are unavailable. Available state is still shown above.' : 'On-chain reads are unavailable right now. Try refreshing when Ethereum responds.'}</p>
        )}
      </div>
    </Card>
    <PendingTransactionRecovery walletAddress={wallet.address as `0x${string}`} />
    </>
  );
}

type ProtocolSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  positions: number | null;
  fxSaveShares: string | null;
  fxSaveAssets: string | null;
  redeemReady: boolean | null;
};

function formatProtocolAmount(value: bigint): string {
  const formatted = formatUnits(value, 18).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return formatted || '0';
}

function WalletUnavailable() {
  return (
    <EmptyState
      icon={Wallet}
      title="Wallet service unavailable"
      body="Wallet access is not configured in this build, so your positions and fxSAVE state cannot be shown."
      action={<Link href="/settings" className="button button-primary glass-press flex min-h-12 w-full items-center justify-center rounded-xl px-4 py-3 text-[15px] font-semibold">Open settings</Link>}
    />
  );
}
