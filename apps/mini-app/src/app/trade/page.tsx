'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Layers2 } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { TradeMarketChart } from '@/components/MarketChart';
import TokenIcon from '@/components/TokenIcon';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { deriveConfirmedPositionHint } from '@/lib/confirmedPositions';
import { confirmedPositionHintKey } from '@/lib/confirmedPositionStorage';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, LeverageField, Segmented, SlippageField, TokenSelect, tokenBalanceFor, useWalletTokenBalances, type TokenBalanceView } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planIncreasePosition, prepareLeverageReview, readLeverageBounds, type LeverageBounds, type PlannedRoute, type TransactionExecutionResult } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
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

export default function TradePage() {
  const wallet = usePrivyWallet();
  // Trade inputs are settled against the Ethereum FX token registry. Read
  // those funds before wallet network switching so review stays informative.
  const walletBalances = useWalletTokenBalances(wallet.address, 1, wallet.chainId);
  const positionState = useProtocolPositions();
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [side, setSide] = useState<UiSide>('long');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));
  const [highlightedPositionKey, setHighlightedPositionKey] = useState('');

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  const tokenOptions = positionInputTokenOptions(market);
  const validAmount = positiveDecimal(amount, tokenDecimals(token));
  const selectedTokenBalance: TokenBalanceView | undefined = wallet.address
    ? tokenBalanceFor(walletBalances.balances, token) ?? (walletBalances.status === 'loading'
      ? { status: 'loading' }
      : { status: 'unavailable', reason: walletBalances.reason })
    : undefined;

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
    return async () => {
      const prepared = await prepareLeverageReview({
        leverage,
        currentBounds: leverageBounds,
        readBounds: () => readLeverageBounds(market, side),
        buildPlan: () => planIncreasePosition({
        market,
        type: side,
        positionId: 0,
        userAddress: wallet.address!,
        leverage,
        inputTokenAddress: tokenAddress(token),
        amount: amountWei,
        slippage: slippageValue,
        }),
      });
      setLeverageBounds(prepared.bounds);
      if (prepared.adjusted) {
        setLeverage(prepared.leverage);
        throw new RangeError(`Pool leverage limits changed to ${prepared.bounds.min.toFixed(1)}x-${prepared.bounds.max.toFixed(1)}x. The target was updated; review it again.`);
      }
      return prepared.plan;
    };
  }, [leverage, leverageBounds, market, side, slippage, token, validAmount, wallet.address]);

  const marketPositions = positionState.positions.filter((position) => position.market === market);
  const highlightedPosition = marketPositions.find((position) => positionKey(position) === highlightedPositionKey);
  const previewPositions = highlightedPosition
    ? [highlightedPosition, ...marketPositions.filter((position) => positionKey(position) !== highlightedPositionKey).slice(-1)]
    : marketPositions.slice(-2).reverse();

  const handleOpenComplete = async (execution: TransactionExecutionResult, route: PlannedRoute) => {
    if (execution.status !== 'confirmed' || execution.operation !== 'increasePosition' || execution.chainId !== 1
      || execution.walletAddress.toLowerCase() !== wallet.address?.toLowerCase()) return;
    void walletBalances.refresh(true);
    if (await positionState.trackConfirmedPosition(execution, route)) {
      const hint = deriveConfirmedPositionHint({ route, result: execution, walletAddress: execution.walletAddress });
      if (hint) setHighlightedPositionKey(confirmedPositionHintKey(hint));
    } else void positionState.refresh();
  };

  return (
    <AppShell tabs>
      <div className={styles.tradeRoot}>
      <div className={`${styles.tradeWorkspace} trade-workspace`}>
        <header className={`${styles.tradePageHeading} trade-page-heading`}>
          <div><p className={styles.pageEyebrow}>f(x) leveraged markets</p><h1 className="text-display mt-1.5 text-[30px] font-semibold leading-tight">Trade</h1></div>
          <Link href="/positions" className="glass-press inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-mut hover:text-mint"><Layers2 className="h-4 w-4" aria-hidden="true" />Positions</Link>
        </header>

        <div className={styles.marketChooser}><Segmented value={market} onChange={(next) => { setMarket(next); setToken(next === 'ETH' ? 'ETH' : 'WBTC'); }} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH market', sub: 'Ethereum', ariaLabel: 'ETH', icon: <TokenIcon symbol="ETH" size={20} /> }, { value: 'BTC', label: 'BTC market', sub: 'Wrapped BTC', ariaLabel: 'BTC', icon: <TokenIcon symbol="WBTC" size={20} /> }]} /></div>
        <div className={styles.tradeLayout}>
        <div className={styles.marketColumn}>
          <TradeMarketChart market={market} />
        </div>
        <div className={styles.ticketColumn}>
        <Card className={`${styles.tradeTicket} trade-ticket`}>
          <div className={`${styles.ticketHeader} mb-4 flex items-start justify-between gap-3`}>
            <div>
              <p className={styles.ticketKicker}>New position</p>
              <h2 className="mt-1 text-[18px] font-semibold">{market} {side === 'long' ? 'Long' : 'Short'}</h2>
            </div>
            <span className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{side === 'long' ? 'Long' : 'Short'}</span>
          </div>

          <div className={styles.sideControl}><Segmented tone="sides" value={side} onChange={setSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]} /></div>

          <div className={styles.fieldStack}>
            <AmountField label="Amount" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} showMax={token !== 'ETH'} balanceState={selectedTokenBalance} tokenSelector={<TokenSelect compact label="Input asset" value={token} options={tokenOptions} onChange={setToken} balances={wallet.address ? walletBalances.balances : undefined} balanceStatus={wallet.address ? (walletBalances.status !== 'idle' ? walletBalances.status : undefined) : 'disconnected'} />} />
            <LeverageField label={side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} />
            <details className={`${styles.advancedDetails} group rounded-xl border border-[var(--line)] px-3`}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
              <div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div>
            </details>
          </div>
        </Card>

        {!wallet.address && <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to review this trade." />}
        <div className={styles.reviewWrap}><ActionReview planBuilder={planBuilder} label={`Review ${market} ${side === 'long' ? 'Long' : 'Short'}`} operationLabel={`Open ${market} ${side}`} onComplete={handleOpenComplete} /></div>
        </div>
        </div>

        {wallet.address && (
          <section aria-labelledby="trade-open-positions-title" className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="trade-open-positions-title" className="text-[15px] font-semibold">Your positions</h2>
              <Link href="/positions" className="glass-press inline-flex min-h-11 items-center gap-1 px-1 text-[12px] font-semibold text-mint">Manage all <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </div>
            <ProtocolPositionNotice status={positionState.status} failedGroups={positionState.failedGroups} hasPositions={positionState.positions.length + positionState.pendingPositions.length > 0} refreshing={positionState.refreshing} onRefresh={() => void positionState.refresh()} compact />
            <ConfirmedPositionCards market={market} />
            {highlightedPosition && <p role="status" aria-live="polite" className="rounded-lg bg-[rgba(36,211,153,.1)] px-3 py-2 text-[12px] font-medium text-success">New position detected and highlighted.</p>}
            {positionState.status === 'loading' && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton compact /> : marketPositions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {previewPositions.map((position) => <ProtocolPositionCard key={positionKey(position)} position={position} compact href="/positions" highlighted={positionKey(position) === highlightedPositionKey} stale={positionIsStale(position, positionState.failedGroups)} />)}
              </div>
            ) : positionState.status === 'ready' && !positionState.pendingPositions.some((hint) => hint.market === market) ? (
              <Link href="/positions" className="trade-positions-link glass-press">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--mint-dim)] text-mint"><Layers2 className="h-5 w-5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><strong className="block text-[13px]">No open {market} positions</strong><small className="mt-1 block text-[12px] text-mut">Your position details will appear here after a trade is confirmed.</small></span>
                <ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
              </Link>
            ) : null}
          </section>
        )}
      </div>
      </div>
    </AppShell>
  );
}
