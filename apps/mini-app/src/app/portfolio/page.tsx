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
  ShieldCheck,
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
            <p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-mint"><span className="status-dot" aria-hidden="true" /> Ethereum + Base</p>
            <h1 className="text-display text-[30px] font-semibold leading-tight tracking-[-0.045em]">Portfolio</h1>
            <p className="mt-1.5 max-w-[290px] text-[13px] leading-relaxed text-mut">A clear starting point for on-chain f(x) state.</p>
          </div>
          <Link href="/settings" onClick={() => haptic('light')} aria-label="Open wallet settings" className="glass-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--mint),var(--cyan))] ring-2 ring-[var(--mint)]/50">
            <Wallet className="h-5 w-5 text-white" aria-hidden="true" />
          </Link>
        </header>

        {privyConfigured() ? <PortfolioWallet /> : <WalletUnavailable />}

        <SectionTitle>Official f(x) scope</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <ActionTile icon={CandlestickChart} label="Trade" hint="Open or increase" href="/trade" />
          <ActionTile icon={Layers2} label="Positions" hint="Read or manage" href="/positions" />
          <ActionTile icon={Banknote} label="Borrow fxUSD" hint="Mint or repay" href="/borrow" />
          <ActionTile icon={PiggyBank} label="fxSAVE" hint="Deposit or redeem" href="/earn" />
          <ActionTile icon={ArrowLeftRight} label="Bridge" hint="Ethereum ↔ Base" href="/move" />
          <ActionTile icon={QrCode} label="Receive" hint="Fund wallet" href="/qr" />
        </div>

        <Card className="mt-6 border-[rgba(139,109,255,.22)] bg-[rgba(139,109,255,.06)]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span>
            <div>
              <p className="text-[13px] font-semibold">Your wallet stays in control</p>
              <p className="mt-1 text-[12px] leading-relaxed text-mut">The official SDK plans transactions. Privy asks you to approve each step, and FxAeon reads the chain again after confirmation.</p>
            </div>
          </div>
        </Card>

        <p className="mt-6 pb-2 text-center text-[9.5px] uppercase tracking-[0.14em] text-[var(--mut-2)]">No fake prices · no background execution · no hidden account database</p>
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
  const [protocol, setProtocol] = useState<ProtocolSnapshot>({ status: 'idle', positions: null, fxSaveShares: null, redeemReady: null });

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
        redeemReady: redeem.status === 'fulfilled' ? redeem.value.isCooldownComplete : null,
      });
    } catch {
      setProtocol({ status: 'unavailable', positions: null, fxSaveShares: null, redeemReady: null });
    }
  }, [wallet?.address]);

  useEffect(() => {
    if (authenticated && wallet?.address && walletState.ready) void loadProtocol();
  }, [authenticated, loadProtocol, wallet?.address, walletState.ready]);

  if (!ready || !walletState.ready) {
    if (walletTimedOut) {
      return <EmptyState icon={RefreshCw} title="Wallet provider did not load" body="Check your connection, update Telegram, or reopen FxAeon. No wallet state was assumed." action={<button type="button" onClick={() => window.location.reload()} className="button button-primary min-h-11 w-full rounded-2xl px-4">Reload wallet provider</button>} />;
    }
    return <Card className="h-36 animate-pulse"><span className="sr-only">Loading wallet</span></Card>;
  }

  if (!authenticated || !wallet) {
    return (
      <Card glow className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-[var(--mint-glow)] blur-3xl" aria-hidden="true" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-mint">Start with your wallet</p>
          <h2 className="mt-2 text-display text-[24px] font-semibold tracking-[-0.04em]">{authenticated ? 'Choose your wallet' : 'Connect to see chain state'}</h2>
          <p className="mt-2 max-w-[310px] text-[12.5px] leading-relaxed text-mut">Balances and positions are never guessed. {authenticated ? 'Create an embedded wallet explicitly or connect one you already control.' : 'Authenticate through Privy, then choose the wallet that will authorize every transaction.'}</p>
          <Link href="/login" className="button button-primary glass-press mt-5 flex min-h-12 w-full max-w-[240px] items-center justify-center rounded-2xl px-4 py-3 text-[15px] font-semibold">{authenticated ? 'Choose wallet' : 'Connect wallet'}</Link>
        </div>
      </Card>
    );
  }

  return (
    <>
    <Card glow className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-[var(--mint-glow)] blur-3xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-mint">Connected wallet</p>
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
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link href="/positions" onClick={() => haptic('light')} className="glass-press flex min-h-[72px] items-center justify-between rounded-2xl border border-[var(--line)] px-3.5 py-3">
            <span><span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-mut">Positions</span><span className="mt-1 block text-[12px] text-mint">{protocol.positions !== null ? `${protocol.positions} open` : protocol.status === 'loading' ? 'Reading chain…' : 'Unavailable'}</span></span><ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
          </Link>
          <Link href="/earn" onClick={() => haptic('light')} className="glass-press flex min-h-[72px] items-center justify-between rounded-2xl border border-[var(--line)] px-3.5 py-3">
            <span><span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-mut">fxSAVE</span><span className="mt-1 block text-[12px] text-mint">{protocol.fxSaveShares !== null ? `${protocol.fxSaveShares} shares` : protocol.status === 'loading' ? 'Reading chain…' : 'Unavailable'}</span></span><ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
          </Link>
        </div>
        {(protocol.status === 'ready' || protocol.status === 'partial') && protocol.redeemReady === true && (
          <p className="mt-3 rounded-xl bg-[var(--success-dim)] px-3 py-2 text-[11px] text-success">fxSAVE redeem is claimable. Open fxSAVE to review the official claim transaction.</p>
        )}
        {(protocol.status === 'unavailable' || protocol.status === 'partial') && (
          <p role="status" className="mt-3 rounded-xl bg-[var(--warn-dim)] px-3 py-2 text-[11px] leading-relaxed text-warn">{protocol.status === 'partial' ? 'Some on-chain reads are unavailable. Available values are shown independently; failed values are never replaced with zero.' : 'On-chain reads are unavailable right now. No balance is shown until Ethereum responds.'}</p>
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
      body="This build has no Privy application configured, so balances and positions cannot be shown. Nothing is substituted with a placeholder value."
      action={<Link href="/settings" className="button button-primary glass-press flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-[15px] font-semibold">Open settings</Link>}
    />
  );
}
