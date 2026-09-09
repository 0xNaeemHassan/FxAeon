'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Layers2 } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { TradeMarketChart } from '@/components/MarketChart';
import {
  ProtocolPositionCard,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { deriveConfirmedPositionHint } from '@/lib/confirmedPositions';
import { confirmedPositionHintKey } from '@/lib/confirmedPositionStorage';
import { AmountField, LeverageField, Segmented, SlippageField, TokenSelect, tokenBalanceFor, useWalletTokenBalances, type TokenBalanceView } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, getEthereumClient, leverageBoundsFor, planIncreasePosition, prepareLeverageReview, readLeverageBounds, readSignatureRequiredDraft, restoreSignatureRequiredDraft, signatureDraftIdFromSearch, type LeverageBounds, type PlannedRoute, type TransactionExecutionResult } from '@/lib/fx';
import { RoutePrefetchStore, type RoutePrefetchDescriptor } from '@/lib/fx/routePrefetch';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import { readTradeDeepLinkContext, resetTransactionAmounts, type TradeDeepLinkContext } from '@/lib/transactionState';
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
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const prefetchStoreRef = useRef<RoutePrefetchStore | null>(null);
  const prefetchSessionRef = useRef(createPrefetchSessionId());
  const prefetchDescriptorRef = useRef<RoutePrefetchDescriptor | null>(null);
  const [foreground, setForeground] = useState(false);
  const previousWalletContextRef = useRef<string | null>(null);
  // Connecting from the disconnected review rail must preserve the ticket.
  // Once a wallet has been selected, later account/network changes still
  // invalidate the wallet-scoped inputs and force a fresh review.
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const explicitDeepLinkRef = useRef<TradeDeepLinkContext | null>(null);
  const initiallyHydratedRef = useRef(Boolean(wallet.address && wallet.chainId));
  const currentTicketRef = useRef('');
  const prefetchedTicketRef = useRef('');
  const restoredDraftRef = useRef(false);

  // Keep the unsigned snapshot primitive-only so History can restore the
  // editable ticket without ever persisting a quote, calldata, or route.
  // Memoising it also prevents ActionReview from rewriting the same local
  // draft on every unrelated price/position refresh.
  const draftState = useMemo(() => ({
    market,
    side,
    token,
    amount,
    leverage,
    slippage,
  }), [amount, leverage, market, side, slippage, token]);
  const draftActionKey = useMemo(() => `trade:${market}:${side}:${token}`, [market, side, token]);

  const resetTradeContext = useCallback((nextMarket: UiMarket = 'ETH', nextSide: UiSide = 'long', nextToken: UiToken = 'ETH') => {
    const defaults = resetTransactionAmounts();
    setMarket(nextMarket);
    setSide(nextSide);
    setToken(nextToken);
    setAmount(defaults.amount);
    setLeverage(defaults.leverage);
    setReviewStage('input');
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
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    if (previous !== null && previous !== context && (walletChanged || chainChanged)) {
      const explicit = explicitDeepLinkRef.current;
      const market = explicit?.market ?? 'ETH';
      const side = explicit?.side ?? 'long';
      const defaultToken = explicit?.asset && positionInputTokenOptions(market).includes(explicit.asset as UiToken)
        ? explicit.asset as UiToken
        : market === 'ETH' ? 'ETH' : 'WBTC';
      resetTradeContext(market, side, defaultToken);
      // Keep the URL context through a two-step browser-wallet hydration
      // (address first, chain second), then let normal user selections win.
      if (wallet.address && wallet.chainId) explicitDeepLinkRef.current = null;
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetTradeContext, wallet.address, wallet.chainId]);

  useEffect(() => {
    const deepLink = readTradeDeepLinkContext(window.location.search);
    explicitDeepLinkRef.current = initiallyHydratedRef.current ? null : deepLink;
    if (deepLink) {
      setMarket(deepLink.market);
      setSide(deepLink.side);
      setToken(positionInputTokenOptions(deepLink.market).find((option) => option === deepLink.asset) ?? positionInputTokenOptions(deepLink.market)[0]);
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

  // History links carry only an opaque local-draft id. Restore the validated
  // primitive ticket after the wallet is known, then consume that id so a
  // refresh cannot repeatedly replay an old signature-required draft. The
  // route is planned and simulated afresh by ActionReview; no executable
  // transaction data is restored from storage.
  useEffect(() => {
    if (restoredDraftRef.current || !wallet.address || wallet.chainId !== 1) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId) return;
    const draft = readSignatureRequiredDraft(draftId);
    if (!draft || draft.operation !== 'increasePosition') return;
    let resumePath: URL;
    try { resumePath = new URL(draft.resumePath, window.location.origin); } catch { return; }
    if (resumePath.origin !== window.location.origin || resumePath.pathname !== '/trade') return;
    const state = draft.formState;
    if (!state) return;
    const nextMarket = state.market === 'BTC' ? 'BTC' : state.market === 'ETH' ? 'ETH' : null;
    const nextSide = state.side === 'short' ? 'short' : state.side === 'long' ? 'long' : null;
    const nextToken = typeof state.token === 'string' && nextMarket
      && positionInputTokenOptions(nextMarket).includes(state.token as UiToken)
      ? state.token as UiToken
      : null;
    const nextAmount = typeof state.amount === 'string' && state.amount.length <= 128 && /^(?:\d+\.?\d*|\.\d+)$/.test(state.amount)
      ? state.amount
      : null;
    const nextLeverage = typeof state.leverage === 'number' && Number.isFinite(state.leverage) ? state.leverage : null;
    const nextSlippage = typeof state.slippage === 'string' && state.slippage.length <= 32 && Number.isFinite(Number(state.slippage))
      ? state.slippage
      : null;
    if (!nextMarket || !nextSide || !nextToken || nextAmount === null || nextLeverage === null || nextSlippage === null
      || nextLeverage <= 0 || Number(nextSlippage) <= 0 || Number(nextSlippage) > MAX_FX_SLIPPAGE_PERCENT
      || draft.actionKey !== `trade:${nextMarket}:${nextSide}:${nextToken}`) return;
    const restored = restoreSignatureRequiredDraft(draftId, {
      walletAddress: wallet.address as `0x${string}`,
      chainId: wallet.chainId,
      operation: 'increasePosition',
      actionKey: draft.actionKey,
    });
    if (!restored) return;
    restoredDraftRef.current = true;
    setMarket(nextMarket);
    setSide(nextSide);
    setToken(nextToken);
    setAmount(nextAmount);
    setLeverage(nextLeverage);
    setSlippage(nextSlippage);
    setReviewStage('input');
    setResumeReview((revision) => revision + 1);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('fxDraft');
    window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, [wallet.address, wallet.chainId]);

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

        <div className={styles.tradeLayout}>
        <div className={styles.marketColumn}>
          <TradeMarketChart market={market} onMarketChange={changeMarket} />
        </div>
        <div className={styles.ticketColumn}>
          {/* The editor and review deliberately share one card. ActionReview
              replaces this content in place, keeping the market context and
              the user's exact draft stable while the wallet is opened. */}
          <Card className={`${styles.tradeTicket} trade-ticket ${reviewStage === 'input' ? '' : styles.tradeTicketReview}`}>
            <ActionReview
              key={reviewRevision}
              surface="content"
              planBuilder={planBuilder}
              prefetchedPlan={prefetchedPlan}
              label={`Review ${market} ${side === 'long' ? 'Long' : 'Short'}`}
              operationLabel={`Open ${market} ${side}`}
              onStageChange={setReviewStage}
              draftState={draftState}
              draftActionKey={draftActionKey}
              draftResumePath="/trade"
              resumeReview={resumeReview}
              editor={
                <>
                  <div className={`${styles.ticketHeader} flex items-start justify-between gap-3`}>
                    <div>
                      <p className={styles.ticketKicker}>New position</p>
                      <h2 className="mt-1 text-[18px] font-semibold">{market} {side === 'long' ? 'Long' : 'Short'}</h2>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{side === 'long' ? 'Long' : 'Short'}</span>
                  </div>

                  <div className={styles.sideControl}><Segmented tone="sides" value={side} onChange={changeSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]} /></div>

                  <div className={styles.fieldStack}>
                    <AmountField compact label="Amount" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} showMax={token !== 'ETH'} showUnitPrice={false} balanceState={selectedTokenBalance} tokenSelector={<TokenSelect compact label="Input asset" value={token} options={tokenOptions} onChange={changeToken} balances={wallet.address ? walletBalances.balances : undefined} balanceStatus={wallet.address ? (walletBalances.status !== 'idle' ? walletBalances.status : undefined) : 'disconnected'} />} />
                    <LeverageField label={side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} compact />
                    <details className={`${styles.advancedDetails} group rounded-xl border border-[var(--line)] px-3`}>
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
                      <div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div>
                    </details>
                  </div>
                </>
              }
              onComplete={handleOpenComplete}
            />
          </Card>
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
            {positionState.status === 'loading' && !positionState.positions.length && !positionState.pendingPositions.length ? <ProtocolPositionSkeleton compact /> : marketPositions.length > 0 ? (
              <div className="flex flex-col gap-2">
                {previewPositions.map((position) => {
                  const key = positionKey(position);
                  const encodedPosition = positionHref(position.market, position.side, position.info.positionId);
                  return (
                    <div key={key} className={styles.tradePositionItem}>
                      <ProtocolPositionCard position={position} compact href={encodedPosition} highlighted={key === highlightedPositionKey} />
                      <div role="group" className={styles.tradePositionActions} aria-label={`Actions for ${position.market} ${position.side} position ${position.info.positionId}`}>
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
