'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Layers2, TrendingDown, TrendingUp } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { TradeMarketChart, useMarketHistory } from '@/components/MarketChart';
import TokenIcon from '@/components/TokenIcon';
import { useLiveMarketQuote, useUsdPrices } from '@/components/PriceProvider';
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
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, getEthereumClient, leverageBoundsFor, planIncreasePosition, prepareLeverageReview, readLeverageBounds, type LeverageBounds, type PlannedRoute, type TransactionExecutionResult } from '@/lib/fx';
import { RoutePrefetchStore, type RoutePrefetchDescriptor } from '@/lib/fx/routePrefetch';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import { resetTransactionAmounts } from '@/lib/transactionState';
import { formatUsdPrice } from '@/lib/prices';
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

function createPrefetchSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function positionHref(market: UiMarket, side: UiSide, positionId: string | number, action?: 'close'): string {
  const key = encodeURIComponent(`${market}:${side}:${positionId}`);
  return `/positions?position=${key}${action ? `&action=${action}` : ''}`;
}

function TradeInstrumentHeader({
  market,
  onMarketChange,
}: {
  market: UiMarket;
  onMarketChange: (market: UiMarket) => void;
}) {
  const history = useMarketHistory(market, '1D');
  const { prices, status } = useUsdPrices();
  const live = useLiveMarketQuote(market);
  const snapshot = history.snapshot;
  const price = live.isFresh ? live.quote?.price : prices[market === 'ETH' ? 'ETH' : 'WBTC'] ?? snapshot?.currentPrice;
  const change = live.isFresh ? live.quote?.percentChange24h : snapshot?.percentChange;
  const high = live.isFresh ? live.quote?.high24h : snapshot ? Math.max(...snapshot.points.map((point) => point.price)) : undefined;
  const low = live.isFresh ? live.quote?.low24h : snapshot ? Math.min(...snapshot.points.map((point) => point.price)) : undefined;
  const positive = change !== undefined && change >= 0;
  const ChangeIcon = positive ? TrendingUp : TrendingDown;
  const freshness = live.isFresh
    ? 'Live market feed'
    : live.status === 'connecting' || live.status === 'reconnecting'
      ? 'Reconnecting · validated price shown'
      : status === 'unavailable'
        ? 'Market feed unavailable'
        : 'Using last validated price';

  return (
    <section className={styles.instrumentHeader} aria-label={`${market} trading instrument`}>
      <div className={styles.instrumentTopline}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={styles.instrumentIcon}><TokenIcon symbol={market === 'ETH' ? 'ETH' : 'WBTC'} size={28} /></span>
          <div className="min-w-0">
            <p className={styles.instrumentEyebrow}>Spot reference</p>
            <h2 className="truncate text-[18px] font-semibold">{market} / USD</h2>
          </div>
        </div>
        <div className={styles.instrumentPrice}>
          <span className="text-display text-[23px] font-semibold tabular-nums">{formatUsdPrice(price)}</span>
          <span className={`inline-flex items-center justify-end gap-1 text-[11px] font-semibold ${change === undefined ? 'text-mut' : positive ? 'text-success' : 'text-danger'}`}>
            {change === undefined ? '24h change unavailable' : <><ChangeIcon className="h-3.5 w-3.5" aria-hidden="true" />{positive ? '+' : ''}{change.toFixed(2)}% 24h</>}
          </span>
        </div>
      </div>
      <div className={styles.instrumentMeta}>
        <span className={styles.instrumentFreshness} role="status"><span className={`status-dot ${live.isFresh ? '' : 'status-dot-warn'}`} aria-hidden="true" />{freshness}</span>
        <dl className={styles.instrumentStats}>
          <div><dt>24h high</dt><dd>{formatUsdPrice(high)}</dd></div>
          <div><dt>24h low</dt><dd>{formatUsdPrice(low)}</dd></div>
        </dl>
      </div>
      <div className={styles.marketChooser}>
        <Segmented value={market} onChange={onMarketChange} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH market', sub: 'Ethereum', ariaLabel: 'ETH', icon: <TokenIcon symbol="ETH" size={20} /> }, { value: 'BTC', label: 'BTC market', sub: 'Wrapped BTC', ariaLabel: 'BTC', icon: <TokenIcon symbol="WBTC" size={20} /> }]} />
      </div>
    </section>
  );
}

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
  const [reviewRevision, setReviewRevision] = useState(0);
  const prefetchStoreRef = useRef<RoutePrefetchStore | null>(null);
  const prefetchSessionRef = useRef(createPrefetchSessionId());
  const prefetchDescriptorRef = useRef<RoutePrefetchDescriptor | null>(null);
  const [foreground, setForeground] = useState(false);
  const previousWalletContextRef = useRef<string | null>(null);
  const currentTicketRef = useRef('');
  const prefetchedTicketRef = useRef('');

  const resetTradeContext = useCallback((nextMarket: UiMarket = 'ETH', nextSide: UiSide = 'long', nextToken: UiToken = 'ETH') => {
    const defaults = resetTransactionAmounts();
    setMarket(nextMarket);
    setSide(nextSide);
    setToken(nextToken);
    setAmount(defaults.amount);
    setLeverage(defaults.leverage);
    prefetchStoreRef.current?.invalidate();
    prefetchDescriptorRef.current = null;
    prefetchedTicketRef.current = '';
    setReviewRevision((revision) => revision + 1);
  }, []);

  const changeMarket = useCallback((nextMarket: UiMarket) => {
    resetTradeContext(nextMarket, side, nextMarket === 'ETH' ? 'ETH' : 'WBTC');
  }, [resetTradeContext, side]);

  const changeSide = useCallback((nextSide: UiSide) => {
    resetTradeContext(market, nextSide, token);
  }, [market, resetTradeContext, token]);

  const changeToken = useCallback((nextToken: UiToken) => {
    resetTradeContext(market, side, nextToken);
  }, [market, resetTradeContext, side]);
  currentTicketRef.current = JSON.stringify([wallet.address, wallet.chainId, market, side, token, amount, leverage, slippage, leverageBounds.min, leverageBounds.max]);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    if (previous !== null && previous !== context) resetTradeContext();
    previousWalletContextRef.current = context;
  }, [resetTradeContext, wallet.address, wallet.chainId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedMarket = params.get('market') === 'BTC' ? 'BTC' : 'ETH';
    const selectedAsset = params.get('asset');
    if (params.has('market') || selectedAsset) {
      setMarket(selectedMarket);
      setToken(positionInputTokenOptions(selectedMarket).find((option) => option === selectedAsset) ?? positionInputTokenOptions(selectedMarket)[0]);
    }
    const update = () => {
      const active = document.visibilityState === 'visible' && navigator.onLine;
      if (!active) {
        prefetchStoreRef.current?.invalidate();
        prefetchDescriptorRef.current = null;
      }
      setForeground(active);
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

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

  const slippageValue = Number(slippage);

  // Keep one short-lived route warm while the ticket is valid. This is a
  // display/review optimization only: ActionReview still rebuilds, simulates,
  // and validates the route immediately before opening the wallet prompt.
  useEffect(() => {
    const store = prefetchStoreRef.current ?? (prefetchStoreRef.current = new RoutePrefetchStore());
    store.invalidate();
    prefetchDescriptorRef.current = null;
    const amountWei = validAmount ? parseAmount(validAmount, token) : null;
    if (!foreground || !wallet.address || !amountWei || !Number.isFinite(leverage)
      || leverage < leverageBounds.min || leverage > leverageBounds.max
      || !Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT) {
      return;
    }

    let active = true;
    const ticket = currentTicketRef.current;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      void (async () => {
        try {
          const blockNumber = await getEthereumClient().getBlockNumber();
          if (!active || currentTicketRef.current !== ticket || document.visibilityState !== 'visible' || !navigator.onLine) return;
          const descriptor: RoutePrefetchDescriptor = {
            sessionId: prefetchSessionRef.current,
            walletAddress: wallet.address!,
            walletChainId: wallet.chainId ?? null,
            routeChainId: 1,
            market,
            side,
            inputTokenAddress: tokenAddress(token),
            amountWei,
            leverage,
            slippagePercent: slippageValue,
            leverageMin: leverageBounds.min,
            leverageMax: leverageBounds.max,
            blockNumber,
          };
          prefetchDescriptorRef.current = descriptor;
          prefetchedTicketRef.current = ticket;
          void store.prime(descriptor, () => planIncreasePosition({
            market,
            type: side,
            positionId: 0,
            userAddress: wallet.address!,
            leverage,
            inputTokenAddress: tokenAddress(token),
            amount: amountWei,
            slippage: slippageValue,
          })).catch(() => undefined);
        } catch {
          // Prefetch is best-effort. The normal plan builder remains available
          // whenever the RPC or SDK is unavailable during the warm-up.
        }
      })();
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
      store.invalidate();
      prefetchDescriptorRef.current = null;
    };
  }, [foreground, leverage, leverageBounds.max, leverageBounds.min, market, side, slippageValue, token, validAmount, wallet.address, wallet.chainId]);

  const prefetchedPlan = useCallback(async (): Promise<PlannedRoute | readonly PlannedRoute[] | null> => {
    const descriptor = prefetchDescriptorRef.current;
    if (!descriptor || !prefetchStoreRef.current) return null;
    const ticket = currentTicketRef.current;
    if (prefetchedTicketRef.current !== ticket) return null;
    return prefetchStoreRef.current.readValidated(descriptor, async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine
        || currentTicketRef.current !== ticket || prefetchDescriptorRef.current !== descriptor) return null;
      const blockNumber = await getEthereumClient().getBlockNumber({ cacheTime: 0 });
      if (document.visibilityState !== 'visible' || !navigator.onLine
        || currentTicketRef.current !== ticket || prefetchDescriptorRef.current !== descriptor) return null;
      return { ...descriptor, blockNumber };
    });
  }, []);

  const planBuilder = useMemo(() => {
    if (!wallet.address || !validAmount) return null;
    const amountWei = parseAmount(validAmount, token);
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
  }, [leverage, leverageBounds, market, side, slippageValue, token, validAmount, wallet.address]);

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

        <TradeInstrumentHeader
          market={market}
          onMarketChange={changeMarket}
        />
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

          <div className={styles.sideControl}><Segmented tone="sides" value={side} onChange={changeSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]} /></div>

          <div className={styles.fieldStack}>
            <AmountField label="Amount" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} showMax={token !== 'ETH'} balanceState={selectedTokenBalance} tokenSelector={<TokenSelect compact label="Input asset" value={token} options={tokenOptions} onChange={changeToken} balances={wallet.address ? walletBalances.balances : undefined} balanceStatus={wallet.address ? (walletBalances.status !== 'idle' ? walletBalances.status : undefined) : 'disconnected'} />} />
            <LeverageField label={side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} />
            <details className={`${styles.advancedDetails} group rounded-xl border border-[var(--line)] px-3`}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
              <div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div>
            </details>
          </div>
        </Card>

        {!wallet.address && <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to review this trade." />}
        <div className={styles.reviewWrap}><ActionReview key={reviewRevision} planBuilder={planBuilder} prefetchedPlan={prefetchedPlan} label={`Review ${market} ${side === 'long' ? 'Long' : 'Short'}`} operationLabel={`Open ${market} ${side}`} onComplete={handleOpenComplete} /></div>
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
                {previewPositions.map((position) => {
                  const key = positionKey(position);
                  const encodedPosition = positionHref(position.market, position.side, position.info.positionId);
                  return (
                    <div key={key} className={styles.tradePositionItem}>
                      <ProtocolPositionCard position={position} compact href={encodedPosition} highlighted={key === highlightedPositionKey} stale={positionIsStale(position, positionState.failedGroups)} />
                      <div className={styles.tradePositionActions} aria-label={`Actions for ${position.market} ${position.side} position ${position.info.positionId}`}>
                        <Link href={encodedPosition} className="glass-press"><ArrowUpRight aria-hidden="true" />Manage</Link>
                        {position.side === 'long' && <Link href={`/borrow?market=${position.market}&position=${position.info.positionId}`} className="glass-press"><Layers2 aria-hidden="true" />Borrow</Link>}
                        <Link href={positionHref(position.market, position.side, position.info.positionId, 'close')} className="glass-press"><ArrowDownRight aria-hidden="true" />Close</Link>
                      </div>
                    </div>
                  );
                })}
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
