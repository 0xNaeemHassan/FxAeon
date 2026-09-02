'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Layers2, RefreshCw, ShieldCheck } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { TradeMarketChart } from '@/components/MarketChart';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, LeverageField, Segmented, SlippageField, TokenSelect } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planIncreasePosition, readLeverageBounds, type LeverageBounds, type TransactionExecutionResult } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import {
  parseAmount,
  positionInputTokenOptions,
  positionKey,
  tokenAddress,
  tokenDecimals,
  type UiMarket,
  type UiSide,
  type UiToken,
} from '@/app/trade/fxUi';

type PendingPositionIndex = {
  market: UiMarket;
  side: UiSide;
  tradeKey: string;
  previousKeys: string[];
  verifiedBaseline: boolean;
  phase: 'checking' | 'waiting';
};

export default function TradePage() {
  const wallet = usePrivyWallet();
  const positionState = useProtocolPositions();
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [side, setSide] = useState<UiSide>('long');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));
  const [highlightedPositionKey, setHighlightedPositionKey] = useState('');
  const [pendingIndex, setPendingIndex] = useState<PendingPositionIndex | null>(null);
  const indexRequestRef = useRef(0);
  const positionSnapshotRef = useRef(positionState);
  const reviewedIndexRef = useRef<PendingPositionIndex | null>(null);
  const tradeKey = `${wallet.address?.toLowerCase() ?? ''}:${market}:${side}`;
  const indexContextRef = useRef({ tradeKey, active: true });

  useEffect(() => {
    indexContextRef.current = { tradeKey, active: true };
    setPendingIndex(null);
    setHighlightedPositionKey('');
    reviewedIndexRef.current = null;
    return () => {
      indexContextRef.current.active = false;
      indexRequestRef.current += 1;
    };
  }, [tradeKey]);

  useEffect(() => { positionSnapshotRef.current = positionState; }, [positionState]);

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  const tokenOptions = positionInputTokenOptions(market);
  const validAmount = positiveDecimal(amount, tokenDecimals(token));

  useEffect(() => {
    let active = true;
    const fallback = leverageBoundsFor(market, side);
    setLeverageBounds(fallback);
    void readLeverageBounds(market, side).then((next) => {
      if (active) setLeverageBounds(next);
    }).catch(() => {
      // The input remains guarded by the conservative fallback while a public
      // RPC is unavailable; the SDK is still the final route authority.
    });
    return () => { active = false; };
  }, [market, side]);

  useEffect(() => {
    setLeverage((current) => clampLeverage(current, leverageBounds));
  }, [leverageBounds]);

  const leverageError = leverage > 0 && leverage < leverageBounds.min
    ? `Minimum pool leverage is ${leverageBounds.min.toFixed(1)}×.`
    : null;

  useEffect(() => {
    if (!tokenOptions.includes(token)) setToken(tokenOptions[0]);
  }, [token, tokenOptions]);

  useEffect(() => {
    if (!highlightedPositionKey) return;
    const timer = window.setTimeout(() => setHighlightedPositionKey(''), 8_000);
    return () => window.clearTimeout(timer);
  }, [highlightedPositionKey]);

  const planBuilder = useMemo(() => {
    if (!wallet.address || !validAmount) return null;
    const amountWei = parseAmount(validAmount, token);
    const slippageValue = Number(slippage);
    if (!amountWei || !Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max || !Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT) return null;
    return () => {
      const baseline = positionSnapshotRef.current;
      reviewedIndexRef.current = {
        market, side, tradeKey,
        previousKeys: baseline.positions.map(positionKey),
        verifiedBaseline: baseline.verifiedGroups.some((group) => group.market === market && group.side === side),
        phase: 'checking',
      };
      return planIncreasePosition({
        market,
        type: side,
        positionId: 0,
        userAddress: wallet.address!,
        leverage,
        inputTokenAddress: tokenAddress(token),
        amount: amountWei,
        slippage: slippageValue,
      });
    };
  }, [leverage, leverageBounds, market, side, slippage, token, tradeKey, validAmount, wallet.address]);

  const marketPositions = positionState.positions.filter((position) => position.market === market);
  const highlightedPosition = marketPositions.find((position) => positionKey(position) === highlightedPositionKey);
  const previewPositions = highlightedPosition
    ? [highlightedPosition, ...marketPositions.filter((position) => positionKey(position) !== highlightedPositionKey).slice(-1)]
    : marketPositions.slice(-2).reverse();

  const checkPositionIndex = async (pending: PendingPositionIndex) => {
    if (!indexContextRef.current.active || indexContextRef.current.tradeKey !== pending.tradeKey) return;
    const requestId = ++indexRequestRef.current;
    const isCurrent = () => indexContextRef.current.active
      && indexContextRef.current.tradeKey === pending.tradeKey
      && requestId === indexRequestRef.current;
    setPendingIndex({ ...pending, phase: 'checking' });
    // The official SDK index can trail receipts. Bounded reads run separately
    // from transaction completion: never hold the signing/result UI open or
    // invite the user to submit the same transaction again while indexing.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isCurrent()) return;
      const result = await positionState.refresh();
      if (!isCurrent()) return;
      const matches = (position: typeof result.positions[number]) => position.market === pending.market && position.side === pending.side;
      const minted = result.newPositions.findLast(matches)
        ?? (pending.verifiedBaseline ? result.positions.findLast((position) => matches(position) && !pending.previousKeys.includes(positionKey(position))) : undefined);
      if (minted) {
        setHighlightedPositionKey(positionKey(minted));
        setPendingIndex(null);
        return;
      }
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500 * (attempt + 1)));
      }
    }
    if (isCurrent()) setPendingIndex({ ...pending, phase: 'waiting' });
  };

  const handleOpenComplete = (execution: TransactionExecutionResult) => {
    if (execution.status !== 'confirmed' || execution.operation !== 'increasePosition' || execution.chainId !== 1
      || execution.walletAddress.toLowerCase() !== wallet.address?.toLowerCase()
      || !indexContextRef.current.active || indexContextRef.current.tradeKey !== tradeKey) return;
    const reviewed = reviewedIndexRef.current;
    if (reviewed?.tradeKey === tradeKey) void checkPositionIndex(reviewed);
  };

  return (
    <AppShell tabs>
      <div className="trade-workspace">
        <header className="trade-page-heading">
          <div><p className="text-[12px] font-medium text-mut">f(x) leveraged markets</p><h1 className="text-display mt-1.5 text-[30px] font-semibold leading-tight">Trade</h1></div>
          <Link href="/positions" className="glass-press inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-mut hover:text-mint"><Layers2 className="h-4 w-4" aria-hidden="true" />Positions</Link>
        </header>

        <Segmented value={market} onChange={(next) => { setMarket(next); setToken(next === 'ETH' ? 'ETH' : 'WBTC'); }} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH market', sub: 'Ethereum', ariaLabel: 'ETH' }, { value: 'BTC', label: 'BTC market', sub: 'Wrapped BTC', ariaLabel: 'BTC' }]} />
        <TradeMarketChart market={market} />

        <div className="trade-view-tabs" aria-label="Trade views">
          <span aria-current="page">Open position</span>
          <Link href="/positions">Manage positions <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>

        <Card className="trade-ticket p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-mut">New position</p>
              <h2 className="mt-1 text-[18px] font-semibold">{market} {side === 'long' ? 'Long' : 'Short'}</h2>
            </div>
            <span className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{side === 'long' ? 'Long' : 'Short'}</span>
          </div>

          <Segmented tone="sides" value={side} onChange={setSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Buy / Long', sub: 'Price rises', ariaLabel: 'Long' }, { value: 'short', label: 'Sell / Short', sub: 'Price falls', ariaLabel: 'Short' }]} />

          <div className="flex flex-col gap-4">
            <TokenSelect label="Input asset" value={token} options={tokenOptions} onChange={setToken} />
            <AmountField label="Amount" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} />
            <LeverageField label={side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} />
            <details className="group rounded-xl border border-[var(--line)] px-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
              <div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div>
            </details>
          </div>
        </Card>

        {!wallet.address && <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to review this trade." />}
        <ActionReview planBuilder={planBuilder} label={`Review ${market} ${side === 'long' ? 'Long' : 'Short'}`} operationLabel={`Open ${market} ${side}`} onComplete={handleOpenComplete} />

        {wallet.address && (
          <section aria-labelledby="trade-open-positions-title" className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="trade-open-positions-title" className="text-[15px] font-semibold">Your positions</h2>
              <Link href="/positions" className="glass-press inline-flex min-h-11 items-center gap-1 px-1 text-[12px] font-semibold text-mint">Manage all <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </div>
            <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length > 0} refreshing={positionState.refreshing} onRefresh={() => void positionState.refresh()} compact />
            {pendingIndex && <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--mint-dim)] p-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-mint" aria-hidden="true" />
              <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">Trade confirmed · syncing position</p><p className="mt-1 text-[12px] leading-relaxed text-mut">{pendingIndex.phase === 'checking' ? 'Loading your position ID and balances.' : 'Your trade is confirmed. Position details are still updating. Check again shortly; do not repeat the trade.'}</p></div>
              <button type="button" aria-label="Check confirmed position" disabled={pendingIndex.phase === 'checking'} onClick={() => void checkPositionIndex(pendingIndex)} className="glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-mint disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${pendingIndex.phase === 'checking' ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
            </div>}
            {highlightedPositionKey && <p role="status" aria-live="polite" className="rounded-lg bg-[rgba(36,211,153,.1)] px-3 py-2 text-[12px] font-medium text-success">New position detected and highlighted.</p>}
            {positionState.status === 'loading' && !positionState.positions.length ? <ProtocolPositionSkeleton compact /> : marketPositions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {previewPositions.map((position) => <ProtocolPositionCard key={positionKey(position)} position={position} compact href="/positions" highlighted={positionKey(position) === highlightedPositionKey} stale={positionIsStale(position, positionState.failedGroups)} />)}
              </div>
            ) : positionState.status === 'ready' && !pendingIndex ? (
              <Link href="/positions" className="trade-positions-link glass-press">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--mint-dim)] text-mint"><Layers2 className="h-5 w-5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><strong className="block text-[13px]">No open {market} positions</strong><small className="mt-1 block text-[12px] text-mut">Your position details will appear here after a trade is confirmed.</small></span>
                <ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
              </Link>
            ) : null}
          </section>
        )}
      </div>
    </AppShell>
  );
}
