'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gauge, Layers2, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Card, EmptyState } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import {
  positionIsStale,
  ProtocolPositionCard,
  ProtocolPositionNotice,
  ProtocolPositionSkeleton,
} from '@/components/ProtocolPositionCard';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { AmountField, LeverageField, RangeField, Segmented, SlippageField, TokenSelect, tokenBalanceFor, useWalletTokenBalances, type TokenBalanceView } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planAdjustPositionLeverage, planIncreasePosition, planReducePosition, prepareLeverageReview, readLeverageBounds, readSignatureRequiredDraft, restoreSignatureRequiredDraftFromSearch, signatureDraftIdFromSearch, type LeverageBounds, type SignatureDraftState } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import { haptic } from '@/lib/telegram';
import { resetTransactionAmounts } from '@/lib/transactionState';
import {
  getSdkReductionAmountWei,
  formatAmount,
  parseAmount,
  positionKey,
  positionCollateralDecimals,
  positionDebtDecimals,
  positionInputTokenOptions,
  positionOutputTokenOptions,
  tokenAddress,
  tokenDecimals,
  type UiToken,
} from '@/app/trade/fxUi';

type PositionAction = 'increase' | 'reduce' | 'close' | 'leverage';

export default function PositionsPage() {
  const wallet = usePrivyWallet();
  const positionState = useProtocolPositions();
  const positions = positionState.positions;
  const [selectedKey, setSelectedKey] = useState('');
  const [action, setAction] = useState<PositionAction>('increase');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [fraction, setFraction] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const managerRef = useRef<HTMLElement>(null);
  const handledDeepLinkRef = useRef('');
  const previousWalletContextRef = useRef<string | null>(null);
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const restoredDraftRef = useRef<string | null>(null);
  const pendingRestoredInputsRef = useRef<{ positionKey: string; token?: UiToken; leverage?: number } | null>(null);
  const walletBalances = useWalletTokenBalances(wallet.address, 1);
  const balanceStatus = walletBalances.status === 'idle' ? 'loading' as const : walletBalances.status;
  const tokenBalanceProps = wallet.address ? { balances: walletBalances.balances, balanceStatus } : {};
  const selectedTokenBalance: TokenBalanceView | undefined = wallet.address
    ? tokenBalanceFor(walletBalances.balances, token) ?? { status: balanceStatus === 'ready' ? 'unavailable' : balanceStatus }
    : undefined;

  // Keep unsigned recovery snapshots limited to editable primitive fields.
  // ActionReview stores this alongside the local signature-required hint; it
  // never contains calldata, quotes, nonces, or a prepared route.
  const draftState = useMemo<SignatureDraftState>(() => ({
    positionKey: selectedKey,
    action,
    token,
    amount,
    fraction: String(fraction),
    leverage: String(leverage),
    slippage,
  }), [action, amount, fraction, leverage, selectedKey, slippage, token]);

  const resetTransactionContext = useCallback((nextAction: PositionAction = 'increase', nextToken: UiToken = 'ETH') => {
    const defaults = resetTransactionAmounts();
    setAction(nextAction);
    setToken(nextToken);
    setAmount(defaults.amount);
    setFraction(nextAction === 'close' ? 100 : defaults.fraction);
    setLeverage(defaults.leverage);
    // Remounting the review state machine immediately discards a prepared
    // route, including a route that was just displayed in the review sheet.
    setReviewRevision((revision) => revision + 1);
  }, []);

  const selectPosition = useCallback((key: string) => {
    setSelectedKey(key);
    resetTransactionContext();
    haptic('selection');
    window.requestAnimationFrame(() => managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [resetTransactionContext]);

  const changeAction = useCallback((nextAction: PositionAction) => {
    resetTransactionContext(nextAction);
  }, [resetTransactionContext]);

  const changeToken = useCallback((nextToken: UiToken) => {
    setToken(nextToken);
    setAmount('');
    setReviewRevision((revision) => revision + 1);
  }, []);

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
      setSelectedKey('');
      resetTransactionContext();
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetTransactionContext, wallet.address, wallet.chainId]);

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);
  useEffect(() => {
    setSelectedKey((current) => current && positions.some((position) => positionKey(position) === current)
      ? current
      : positions[0] ? positionKey(positions[0]) : '');
  }, [positions]);

  // Trade and portfolio action links land directly on the matching position
  // manager. Keep this query-driven so browser refreshes and shared links have
  // the same behavior as an in-app selection.
  useEffect(() => {
    if (typeof window === 'undefined' || !positions.length) return;
    const params = new URLSearchParams(window.location.search);
    const key = params.get('position');
    if (!key || !positions.some((position) => positionKey(position) === key)) return;
    const requestedAction = params.get('action');
    const nextAction: PositionAction = requestedAction === 'close' || requestedAction === 'reduce' || requestedAction === 'leverage'
      ? requestedAction
      : 'increase';
    const deepLinkKey = `${key}:${nextAction}`;
    if (handledDeepLinkRef.current === deepLinkKey) return;
    handledDeepLinkRef.current = deepLinkKey;
    setSelectedKey(key);
    resetTransactionContext(nextAction);
    window.requestAnimationFrame(() => managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [positions, resetTransactionContext]);

  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const selectedStale = selected ? positionIsStale(selected, positionState.failedGroups) : false;
  const decisionBefore = useMemo(() => selected ? [
    { label: 'Collateral', value: `${formatAmount(selected.info.rawColls, positionCollateralDecimals(selected))} ${selected.info.rawCollsToken}` },
    { label: 'Debt', value: `${formatAmount(selected.info.rawDebts, positionDebtDecimals(selected))} ${selected.info.rawDebtsToken}` },
  ] : undefined, [selected]);
  const marketTokens = selected
    ? action === 'reduce' || action === 'close'
      ? positionOutputTokenOptions(selected.market, selected.side)
      : positionInputTokenOptions(selected.market)
    : positionInputTokenOptions('ETH');
  const validAmount = positiveDecimal(amount, tokenDecimals(token));

  useEffect(() => {
    if (!selected) return;
    setToken((current) => marketTokens.includes(current) ? current : marketTokens[0]);
    const sdkLeverage = selected.side === 'short' ? selected.info.lsdLeverage : selected.info.currentLeverage;
    // This is an editable target, not the measured position metric. Seed a
    // readable target and pass that exact displayed value into the review.
    const targetLeverage = Number(Math.max(0.1, sdkLeverage).toFixed(2));
    setLeverage(clampLeverage(targetLeverage, leverageBounds));
  }, [leverageBounds, marketTokens, selected]);

  // A selected position normally seeds a fresh leverage target from the
  // canonical read. Let a validated History draft override that seed once,
  // after the action-specific token list and current pool bounds are ready.
  useEffect(() => {
    const pending = pendingRestoredInputsRef.current;
    if (!pending || !selected || pending.positionKey !== positionKey(selected)) return;
    if (pending.token && !marketTokens.includes(pending.token)) return;
    if (pending.token) setToken(pending.token);
    if (pending.leverage !== undefined && Number.isFinite(pending.leverage)) {
      setLeverage(clampLeverage(pending.leverage, leverageBounds));
    }
    pendingRestoredInputsRef.current = null;
  }, [leverageBounds, marketTokens, selected]);

  useEffect(() => {
    let active = true;
    if (!selected) return () => { active = false; };
    const fallback = leverageBoundsFor(selected.market, selected.side);
    setLeverageBounds(fallback);
    void readLeverageBounds(selected.market, selected.side).then((next) => {
      if (active) setLeverageBounds(next);
    }).catch(() => {
      // Keep the conservative fallback; the SDK remains the final planner
      // authority when the user asks to review a transaction.
    });
    return () => { active = false; };
  }, [selected]);

  // History resumes carry only safe form primitives. Verify the current
  // wallet, network, operation, stable position/action key, and same-origin
  // route before restoring them. ActionReview still rebuilds and simulates a
  // fresh SDK route; no saved route or calldata is ever reused.
  useEffect(() => {
    if (typeof window === 'undefined' || !wallet.address || !wallet.chainId || !positions.length) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId || restoredDraftRef.current === draftId) return;
    const draft = readSignatureRequiredDraft(draftId);
    if (!draft || draft.walletAddress.toLowerCase() !== wallet.address.toLowerCase() || draft.chainId !== wallet.chainId) return;
    try {
      if (new URL(draft.resumePath, window.location.origin).pathname !== '/positions') return;
    } catch {
      return;
    }

    const form = draft.formState;
    const formAction = form?.action;
    const nextAction: PositionAction | null = formAction === 'increase' || formAction === 'reduce' || formAction === 'close' || formAction === 'leverage'
      ? formAction
      : null;
    const expectedOperation = nextAction === 'increase'
      ? 'increasePosition'
      : nextAction === 'leverage'
        ? 'adjustPositionLeverage'
        : nextAction === 'reduce' || nextAction === 'close'
          ? 'reducePosition'
          : null;
    if (!nextAction || draft.operation !== expectedOperation) return;

    const draftPositionKey = typeof form?.positionKey === 'string' ? form.positionKey : '';
    const selectedPosition = positions.find((item) => positionKey(item) === draftPositionKey);
    if (!selectedPosition) return;
    const expectedActionKey = `position:${selectedPosition.info.positionId}:${nextAction === 'close' ? 'close' : 'manage'}`;
    if (draft.actionKey !== expectedActionKey) return;
    const restored = restoreSignatureRequiredDraftFromSearch(window.location.search, {
      walletAddress: wallet.address as `0x${string}`,
      chainId: wallet.chainId as 1 | 8453,
      operation: draft.operation,
      actionKey: expectedActionKey,
    });
    if (!restored) return;

    const allowedTokens = nextAction === 'reduce' || nextAction === 'close'
      ? positionOutputTokenOptions(selectedPosition.market, selectedPosition.side)
      : positionInputTokenOptions(selectedPosition.market);
    const nextToken = typeof form?.token === 'string' && allowedTokens.includes(form.token as UiToken)
      ? form.token as UiToken
      : allowedTokens[0];
    const nextAmount = typeof form?.amount === 'string' && form.amount.length <= 100 ? form.amount : '';
    const nextFraction = typeof form?.fraction === 'string' ? Number(form.fraction) : NaN;
    const nextLeverage = typeof form?.leverage === 'string' ? Number(form.leverage) : NaN;
    const nextSlippage = typeof form?.slippage === 'string' && form.slippage.length <= 32 ? form.slippage : slippage;

    restoredDraftRef.current = draftId;
    pendingRestoredInputsRef.current = {
      positionKey: draftPositionKey,
      token: nextToken,
      leverage: Number.isFinite(nextLeverage) ? nextLeverage : undefined,
    };
    setSelectedKey(draftPositionKey);
    setAction(nextAction);
    setToken(nextToken);
    setAmount(nextAmount);
    if (nextAction === 'close') setFraction(100);
    else if (Number.isFinite(nextFraction)) setFraction(Math.min(99, Math.max(1, Math.round(nextFraction))));
    if (Number.isFinite(nextLeverage)) setLeverage(nextLeverage);
    setSlippage(nextSlippage);
    setReviewRevision((revision) => revision + 1);
    setResumeReview((revision) => revision + 1);
    // Remove the opaque local id after successful validation so a refresh
    // cannot re-consume an already restored draft. The saved draft itself
    // remains available in History until the fresh route is signed/cancelled.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`);
  }, [positions, slippage, wallet.address, wallet.chainId]);

  const leverageError = leverage > 0 && leverage < leverageBounds.min
    ? `Minimum pool leverage is ${leverageBounds.min.toFixed(1)}×.`
    : null;

  const planBuilder = useMemo(() => {
    if (!selected || !wallet.address || selectedStale) return null;
    const slippageValue = Number(slippage);
    if (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT) return null;
    const common = {
      market: selected.market,
      type: selected.side,
      positionId: selected.info.positionId,
      userAddress: wallet.address,
      slippage: slippageValue,
    } as const;
    if (action === 'increase') {
      const amountWei = validAmount ? parseAmount(validAmount, token) : null;
      if (!amountWei || !Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max) return null;
      // The SDK's short-pool increase path expects the LSD leverage field,
      // while long pools use the regular leverage field. Both are exposed as
      // an editable target so an existing position can actually exercise the
      // complete official increasePosition input surface.
      return async () => {
        const prepared = await prepareLeverageReview({
          leverage,
          currentBounds: leverageBounds,
          readBounds: () => readLeverageBounds(selected.market, selected.side),
          buildPlan: () => planIncreasePosition({ ...common, leverage, inputTokenAddress: tokenAddress(token), amount: amountWei }),
        });
        setLeverageBounds(prepared.bounds);
        if (prepared.adjusted) {
          setLeverage(prepared.leverage);
          throw new RangeError(`Pool leverage limits changed to ${prepared.bounds.min.toFixed(1)}x-${prepared.bounds.max.toFixed(1)}x. The target was updated; review it again.`);
        }
        return prepared.plan;
      };
    }
    if (action === 'reduce' || action === 'close') {
      return async () => {
        const reductionFraction = action === 'close' ? 100 : fraction;
        const reduction = await getSdkReductionAmountWei({
          market: selected.market,
          side: selected.side,
          rawCollateralWei: selected.info.rawColls,
          rawDebtWei: selected.info.rawDebts,
          fractionBps: reductionFraction * 100,
        });
        return planReducePosition({ ...common, amount: reduction, outputTokenAddress: tokenAddress(token), isClosePosition: action === 'close' });
      };
    }
    if (!Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max) return null;
    return async () => {
      const prepared = await prepareLeverageReview({
        leverage,
        currentBounds: leverageBounds,
        readBounds: () => readLeverageBounds(selected.market, selected.side),
        buildPlan: () => planAdjustPositionLeverage({ ...common, leverage }),
      });
      setLeverageBounds(prepared.bounds);
      if (prepared.adjusted) {
        setLeverage(prepared.leverage);
        throw new RangeError(`Pool leverage limits changed to ${prepared.bounds.min.toFixed(1)}x-${prepared.bounds.max.toFixed(1)}x. The target was updated; review it again.`);
      }
      return prepared.plan;
    };
  }, [action, fraction, leverage, leverageBounds, selected, selectedStale, slippage, token, validAmount, wallet.address]);

  const openManager = (key: string, nextAction: PositionAction) => {
    const position = positions.find((item) => positionKey(item) === key);
    const nextToken = position
      ? (nextAction === 'reduce' || nextAction === 'close'
        ? positionOutputTokenOptions(position.market, position.side)[0]
        : positionInputTokenOptions(position.market)[0])
      : 'ETH';
    setSelectedKey(key);
    resetTransactionContext(nextAction, nextToken);
    haptic(nextAction === 'close' ? 'warning' : 'selection');
    window.requestAnimationFrame(() => managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const reviewLabel = action === 'close' ? 'Review close' : `Review ${action}`;
  const operationLabel = action === 'close'
    ? `Close ${selected?.market} ${selected?.side} position`
    : action === 'increase'
      ? `Add to ${selected?.market} position`
        : action === 'reduce'
          ? `Reduce ${selected?.market} position`
          : `Adjust ${selected?.market} position leverage`;
  const draftActionKey = selected
    ? `position:${selected.info.positionId}:${action === 'close' ? 'close' : 'manage'}`
    : undefined;
  const draftResumePath = selected
    ? `/positions?position=${encodeURIComponent(positionKey(selected))}&action=${encodeURIComponent(action)}`
    : undefined;

  return (
    <AppShell title="Positions">
      <div className={`${styles.positionsRoot} ${styles.positionsCompactRoot}`}>
      <div className={styles.positionsWorkspace}>
        <nav className="grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[var(--input)] p-1" aria-label="Trade views">
          <Link href="/trade" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">New position</Link>
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">Positions</span>
        </nav>
        {!wallet.address ? (
          <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to see and manage your open positions." />
        ) : (
          <ProtocolPositionNotice
            status={positionState.status}
            failedGroups={positionState.failedGroups}
            hasPositions={positions.length + positionState.pendingPositions.length > 0}
            refreshing={positionState.refreshing}
            onRefresh={() => void positionState.refresh()}
          />
        )}
        <ConfirmedPositionCards />
        {wallet.address && positionState.status === 'loading' && !positions.length && !positionState.pendingPositions.length ? (
          <div className="flex flex-col gap-3"><ProtocolPositionSkeleton /><ProtocolPositionSkeleton /></div>
        ) : wallet.address && positionState.status === 'unavailable' && !positions.length && !positionState.pendingPositions.length ? (
          <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><span className="text-[12px] text-warn">Position data is unavailable.</span><button type="button" aria-label="Retry positions" onClick={() => void positionState.refresh()} className="glass-press ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut"><RefreshCw className="h-4 w-4" aria-hidden="true" /></button></div>
        ) : wallet.address && positionState.status === 'partial' && !positions.length && !positionState.pendingPositions.length ? (
          <div role="status" aria-live="polite" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[12px] text-warn">Some position groups are unavailable. Retry before relying on the empty state.<button type="button" onClick={() => void positionState.refresh()} className="mt-2 min-h-11 rounded-lg px-2 font-semibold text-mint">Retry positions</button></div>
        ) : wallet.address && positionState.status === 'ready' && !positions.length && !positionState.pendingPositions.length ? (
          <EmptyState icon={Layers2} title="No open positions" body="Open an ETH or BTC position to get started." action={<Link href="/trade" className="button button-primary flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold">Open a position</Link>} />
        ) : wallet.address && positions.length > 0 ? (
          <div className={styles.positionManagerGrid}>
            <section className={styles.positionsColumn} aria-labelledby="open-positions-heading">
              <div className={styles.positionSectionHeader}>
                <div><p className={styles.ticketKicker}>Your portfolio</p><h2 id="open-positions-heading">Open positions</h2></div>
                <span>{positions.length} shown</span>
              </div>
              <div className={styles.positionList} aria-label="Open positions">
                {positions.map((position) => {
                  const key = positionKey(position);
                  const isSelected = key === selectedKey;
                  return (
                    <div key={key} className={styles.positionListItem}>
                      <ProtocolPositionCard
                        position={position}
                        compact
                        selected={isSelected}
                        onSelect={() => selectPosition(key)}
                      />
                      <div className={`${styles.positionQuickActions} ${position.side === 'long' ? styles.positionQuickActionsWithBorrow : ''}`} aria-label={`Actions for ${position.market} ${position.side} position ${position.info.positionId}`}>
                        <button type="button" onClick={() => openManager(key, isSelected ? action : 'increase')} className="glass-press">Manage</button>
                        {position.side === 'long' && <Link href={`/borrow?market=${position.market}&position=${position.info.positionId}`} className="glass-press">Borrow</Link>}
                        <button type="button" onClick={() => openManager(key, 'close')} className="glass-press"><X aria-hidden="true" /> Close</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section ref={managerRef} className={styles.positionManageColumn} aria-labelledby="manage-position-heading">
              {selected && <div className={styles.manageHeading}><div><p className={styles.ticketKicker}>Selected position</p><h2 id="manage-position-heading">{selected.market} {selected.side} · #{selected.info.positionId}</h2></div>{selected.side === 'long' && <Link href={`/borrow?market=${selected.market}&position=${selected.info.positionId}`} className="glass-press inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-[12px] font-semibold text-mint">Borrow against <span aria-hidden="true">→</span></Link>}</div>}
              {selectedStale && <span role="status" aria-label="Refreshing selected position" className="skeleton block h-8 rounded-xl" />}

              <Card className={`${styles.actionPanel} ${styles.positionActionCard}`}>
                <div className={styles.positionActions}><Segmented value={action} onChange={changeAction} ariaLabel="Position action" options={[{ value: 'increase', label: 'Add' }, { value: 'reduce', label: 'Reduce' }, { value: 'close', label: 'Close' }, { value: 'leverage', label: 'Leverage' }]} /></div>
                <ActionReview
                  key={reviewRevision}
                  surface="content"
                  planBuilder={planBuilder}
                  label={reviewLabel}
                  operationLabel={operationLabel}
                  destructive={action === 'close'}
                  draftState={draftState}
                  draftActionKey={draftActionKey}
                  draftResumePath={draftResumePath}
                  resumeReview={resumeReview}
                  decisionBefore={decisionBefore}
                  editor={(
                    <div className={styles.positionEditor}>
                      {action === 'increase' && <div className={styles.fieldStack}><Header icon={ArrowUpRight} title="Increase exposure" body="Add collateral and choose the target leverage for this position." /><TokenSelect label="Input asset" value={token} options={marketTokens} onChange={changeToken} {...tokenBalanceProps} /><AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} balanceState={selectedTokenBalance} /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
                      {action === 'reduce' && <div className={styles.fieldStack}><Header icon={ArrowDownRight} title="Reduce exposure" body="Choose how much of this position to reduce and what asset to receive." /><RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={99} step={1} suffix="%" /><div className="grid grid-cols-3 gap-2">{[25, 50, 75].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`min-h-11 rounded-xl text-[11px] font-semibold ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.035)] text-mut'}`}>{value}%</button>)}</div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={changeToken} {...tokenBalanceProps} /></div>}
                      {action === 'close' && <div className={styles.fieldStack}><Header icon={X} title="Close the full position" body="Close 100% of this position and choose the asset returned to your wallet." /><div className={styles.closeNotice}><strong>Full close</strong><span>All remaining collateral and debt</span><small>The review will show the route, limits, approvals, and exact transaction count before your wallet opens.</small></div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={changeToken} {...tokenBalanceProps} /></div>}
                      {action === 'leverage' && <div className={styles.fieldStack}><Header icon={Gauge} title="Adjust leverage" body="Set the target leverage for this position." /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
                      <details className={`${styles.advancedDetails} group mt-4 rounded-xl border border-[var(--line)] px-3`}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary><div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div></details>
                    </div>
                  )}
                  onComplete={async (_execution, confirmedRoute) => {
                    await Promise.all([positionState.refresh(), walletBalances.refresh()]);
                    if (action === 'close' && selected && confirmedRoute.details?.positionId === selected.info.positionId) {
                      await positionState.reconcileClosedPosition(selected);
                    }
                  }}
                />
              </Card>
            </section>
          </div>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}

function Header({ icon: Icon, title, body }: { icon: typeof ArrowUpRight; title: string; body: string }) { return <div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-mint" aria-hidden="true" /><h2 className="text-[15px] font-semibold">{title}</h2></div><p className="mt-1 text-[12px] text-mut">{body}</p></div>; }
