'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ProtocolPositionNotice } from '@/components/ProtocolPositionCard';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { AmountField, InfoNote, Segmented, TokenSelect, useWalletTokenBalances } from '@/components/ProtocolForm';
import { useUsdPrices } from '@/components/PriceProvider';
import {
  planDepositAndMint,
  planRepayAndWithdraw,
  restoreSignatureRequiredDraftFromSearch,
  signatureDraftIdFromSearch,
  type PlannedRoute,
  type SignatureDraftState,
  type TransactionExecutionResult,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import {
  ETH_MARKET_TOKENS,
  BTC_MARKET_TOKENS,
  formatAmount,
  parseZeroAmount,
  positionCollateralDecimals,
  positionDebtDecimals,
  positionIsStale,
  positionKey,
  tokenAddress,
  tokenDecimals,
  type UiMarket,
  type UiPosition,
  type UiToken,
} from '@/app/trade/fxUi';
import styles from '@/components/FlowWorkspace.module.css';
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';
import { priceKeyForSymbol } from '@/lib/prices';
import { resetTransactionAmounts } from '@/lib/transactionState';

type BorrowMode = 'mint' | 'manage';

const BORROW_DRAFT_SCOPES = [
  { mode: 'mint', operation: 'depositAndMint', actionKey: 'borrow:new' },
  { mode: 'mint', operation: 'depositAndMint', actionKey: 'borrow:add' },
  { mode: 'manage', operation: 'repayAndWithdraw', actionKey: 'borrow:manage' },
] as const;

function isBorrowMode(value: unknown): value is BorrowMode {
  return value === 'mint' || value === 'manage';
}

function isBorrowMarket(value: unknown): value is UiMarket {
  return value === 'ETH' || value === 'BTC';
}

function isBorrowToken(value: unknown): value is UiToken {
  return typeof value === 'string' && (
    ETH_MARKET_TOKENS.includes(value as UiToken) || BTC_MARKET_TOKENS.includes(value as UiToken)
  );
}

function isBorrowResumePath(value: string): boolean {
  try {
    const url = new URL(value, 'https://fxaeon.local');
    return url.origin === 'https://fxaeon.local' && url.pathname === '/borrow';
  } catch {
    return false;
  }
}

type BorrowDraftRestore = {
  state: SignatureDraftState;
  actionKey: (typeof BORROW_DRAFT_SCOPES)[number]['actionKey'];
};

/** Restore only validated primitive form state from this wallet's History. */
function restoreBorrowDraft(search: string, walletAddress: string): BorrowDraftRestore | undefined {
  for (const scope of BORROW_DRAFT_SCOPES) {
    const restored = restoreSignatureRequiredDraftFromSearch(search, {
      walletAddress: walletAddress as `0x${string}`,
      chainId: 1,
      operation: scope.operation,
      actionKey: scope.actionKey,
    });
    if (!restored || !isBorrowResumePath(restored.draft.resumePath)) continue;
    const state = restored.formState;
    if (
      state.mode !== scope.mode
      || !isBorrowMode(state.mode)
      || (state.market !== undefined && !isBorrowMarket(state.market))
      || (state.token !== undefined && !isBorrowToken(state.token))
      || (state.deposit !== undefined && typeof state.deposit !== 'string')
      || (state.mint !== undefined && typeof state.mint !== 'string')
      || (state.repay !== undefined && typeof state.repay !== 'string')
      || (state.withdraw !== undefined && typeof state.withdraw !== 'string')
      || (state.selectedKey !== undefined && typeof state.selectedKey !== 'string')
    ) continue;
    return { state, actionKey: scope.actionKey };
  }
  return undefined;
}

const EMPTY_POSITIONS: UiPosition[] = [];
const ETH_COLLATERAL_TOKENS = ETH_MARKET_TOKENS.filter((item) => !['USDC', 'USDT', 'fxUSD'].includes(item));
const BTC_COLLATERAL_TOKENS = BTC_MARKET_TOKENS.filter((item) => item === 'WBTC');

function collateralTokensForMarket(market: UiMarket): readonly UiToken[] {
  return market === 'ETH' ? ETH_COLLATERAL_TOKENS : BTC_COLLATERAL_TOKENS;
}

export default function BorrowPage() {
  const wallet = usePrivyWallet();
  const sharedPositions = useProtocolPositions();
  const trackConfirmedPosition = sharedPositions.trackConfirmedPosition;
  const [mode, setMode] = useState<BorrowMode>('mint');
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [selectedKey, setSelectedKey] = useState('new');
  const [token, setToken] = useState<UiToken>('ETH');
  const [deposit, setDeposit] = useState('');
  const [mint, setMint] = useState('');
  const [repay, setRepay] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const deepLinkApplied = useRef(false);
  const previousWalletContextRef = useRef<string | null>(null);
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const restoredDraftRef = useRef<string | null>(null);
  // Borrowing is Ethereum-only in the official SDK. Keep the read tied to the
  // selected address while using Ethereum's reviewed client regardless of the
  // wallet's currently displayed chain.
  const balanceSnapshot = useWalletTokenBalances(wallet.address, 1);
  const refreshBalances = balanceSnapshot.refresh;
  const balanceStatus = wallet.address
    ? (balanceSnapshot.status === 'idle' ? 'loading' : balanceSnapshot.status)
    : undefined;
  const balanceStateFor = (key: string) => wallet.address
    ? balanceSnapshot.balances[key] ?? { status: balanceStatus ?? 'loading' as const }
    : undefined;
  const refreshPositions = sharedPositions.refresh;
  const refreshAfterAction = useCallback(async (execution: TransactionExecutionResult, route: PlannedRoute) => {
    await trackConfirmedPosition(execution, route);
    await Promise.all([refreshPositions(), refreshBalances()]);
  }, [refreshBalances, refreshPositions, trackConfirmedPosition]);

  useEffect(() => {
    deepLinkApplied.current = false;
  }, [wallet.address]);

  const positions = useMemo(() => {
    const currentAddress = sharedPositions.walletAddress?.toLowerCase();
    const walletAddress = wallet.address?.toLowerCase();
    if (!walletAddress || currentAddress !== walletAddress) return EMPTY_POSITIONS;
    return sharedPositions.positions.filter((position) => position.side === 'long');
  }, [sharedPositions.positions, sharedPositions.walletAddress, wallet.address]);
  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const selectedStale = selected ? positionIsStale(selected, sharedPositions.failedGroups) : false;
  const decisionBefore = useMemo(() => selected ? [
    { label: 'Collateral', value: formatPositionCollateral(selected) },
    { label: 'Debt', value: formatPositionDebt(selected) },
  ] : undefined, [selected]);
  const marketPositions = positions.filter((position) => position.market === market);
  const collateralTokens = collateralTokensForMarket(market);
  const withdrawalTokens = collateralTokensForMarket(selected?.market ?? market);
  const activeTokenOptions = mode === 'manage' ? withdrawalTokens : collateralTokens;

  const draftState = useMemo<SignatureDraftState>(() => ({
    mode,
    market,
    selectedKey,
    token,
    deposit,
    mint,
    repay,
    withdraw,
  }), [deposit, market, mint, mode, repay, selectedKey, token, withdraw]);
  const draftActionKey = mode === 'manage'
    ? 'borrow:manage'
    : selectedKey === 'new'
      ? 'borrow:new'
      : 'borrow:add';

  const resetTransactionContext = useCallback((nextToken: UiToken = 'ETH') => {
    const defaults = resetTransactionAmounts();
    setToken(nextToken);
    setDeposit(defaults.deposit);
    setMint(defaults.mint);
    setRepay(defaults.repay);
    setWithdraw(defaults.withdraw);
    setReviewStage('input');
    // Remounting the review state machine immediately discards a prepared
    // route, including a route that was just displayed in the review sheet.
    setReviewRevision((revision) => revision + 1);
  }, []);

  const changeMode = useCallback((nextMode: BorrowMode) => {
    setMode(nextMode);
    resetTransactionContext(collateralTokensForMarket(market)[0]);
  }, [market, resetTransactionContext]);

  const changeMarket = useCallback((nextMarket: UiMarket) => {
    setMarket(nextMarket);
    setSelectedKey('new');
    resetTransactionContext(collateralTokensForMarket(nextMarket)[0]);
  }, [resetTransactionContext]);

  const changePosition = useCallback((nextKey: string) => {
    setSelectedKey(nextKey);
    resetTransactionContext(collateralTokensForMarket(market)[0]);
  }, [market, resetTransactionContext]);

  const changeToken = useCallback((nextToken: UiToken) => {
    resetTransactionContext(nextToken);
  }, [resetTransactionContext]);

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
      setMode('mint');
      setMarket('ETH');
      setSelectedKey('new');
      resetTransactionContext('ETH');
    }
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetTransactionContext, wallet.address, wallet.chainId]);

  // History links carry only an opaque local-draft id. Restore the validated
  // primitive form after the exact Ethereum wallet is available, then consume
  // the query id so a reload cannot replay the same snapshot. ActionReview
  // still plans and simulates a fresh SDK route before signing.
  useEffect(() => {
    if (typeof window === 'undefined' || !wallet.address || wallet.chainId !== 1) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId) return;
    const attemptKey = `${draftId}:${wallet.address.toLowerCase()}:${wallet.chainId}`;
    if (restoredDraftRef.current === attemptKey) return;
    const restored = restoreBorrowDraft(window.location.search, wallet.address);
    if (!restored) {
      restoredDraftRef.current = attemptKey;
      return;
    }

    const { state, actionKey } = restored;
    const restoredMode = state.mode;
    if (!isBorrowMode(restoredMode)) {
      restoredDraftRef.current = attemptKey;
      return;
    }
    const restoredMarket = isBorrowMarket(state.market) ? state.market : 'ETH';
    const restoredPositionKey = typeof state.selectedKey === 'string' ? state.selectedKey : '';
    if ((actionKey === 'borrow:new' && restoredPositionKey !== 'new')
      || (actionKey === 'borrow:add' && (!restoredPositionKey || restoredPositionKey === 'new'))
      || (actionKey === 'borrow:manage' && (!restoredPositionKey || restoredPositionKey === 'new'))) {
      restoredDraftRef.current = attemptKey;
      return;
    }
    // Existing-position drafts must wait for the provider snapshot so a
    // temporary empty loading state cannot silently turn an add/manage action
    // into a new position.
    if (restoredPositionKey !== 'new') {
      const restoredPosition = positions.find((position) => positionKey(position) === restoredPositionKey);
      if (!restoredPosition) {
        const positionsForWallet = sharedPositions.walletAddress?.toLowerCase() === wallet.address.toLowerCase();
        const readSettled = sharedPositions.status !== 'loading' && sharedPositions.status !== 'idle';
        if (!positionsForWallet || !readSettled) return;
        restoredDraftRef.current = attemptKey;
        return;
      }
      if (restoredPosition.market !== restoredMarket) {
        restoredDraftRef.current = attemptKey;
        return;
      }
    }

    const restoredTokens = collateralTokensForMarket(restoredMarket);
    const restoredToken = typeof state.token === 'string' && restoredTokens.includes(state.token as UiToken)
      ? state.token as UiToken
      : restoredTokens[0];
    restoredDraftRef.current = attemptKey;
    setMode(restoredMode);
    setMarket(restoredMarket);
    setSelectedKey(restoredPositionKey);
    setToken(restoredToken);
    if (typeof state.deposit === 'string') setDeposit(state.deposit);
    if (typeof state.mint === 'string') setMint(state.mint);
    if (typeof state.repay === 'string') setRepay(state.repay);
    if (typeof state.withdraw === 'string') setWithdraw(state.withdraw);
    setReviewStage('input');
    setReviewRevision((revision) => revision + 1);
    setResumeReview((revision) => revision + 1);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('fxDraft');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // History is optional in embedded/older webviews; restoration is still
      // complete when the URL cannot be rewritten.
    }
  }, [positions, sharedPositions.status, sharedPositions.walletAddress, wallet.address, wallet.chainId]);

  useEffect(() => {
    if (
      deepLinkApplied.current
      || !wallet.address
      || sharedPositions.walletAddress?.toLowerCase() !== wallet.address.toLowerCase()
    ) return;
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedMarket = params.get('market');
    const requestedId = Number(params.get('position'));
    if ((requestedMarket !== 'ETH' && requestedMarket !== 'BTC') || !Number.isSafeInteger(requestedId) || requestedId <= 0) return;
    const requested = positions.find((position) => (
      position.side === 'long'
      && position.market === requestedMarket
      && position.info.positionId === requestedId
    ));
    if (!requested) return;
    setMode('mint');
    setMarket(requested.market);
    setSelectedKey(positionKey(requested));
    resetTransactionContext(collateralTokensForMarket(requested.market)[0]);
  }, [positions, resetTransactionContext, sharedPositions.walletAddress, wallet.address]);

  useEffect(() => {
    setSelectedKey((current) => {
      if (mode === 'mint') {
        return current === 'new' || positions.some((position) => positionKey(position) === current) ? current : 'new';
      }
      return positions.some((position) => positionKey(position) === current)
        ? current
        : positions[0]
          ? positionKey(positions[0])
          : '';
    });
  }, [mode, positions]);

  useEffect(() => {
    if (mode === 'manage' && selected) setMarket(selected.market);
  }, [mode, selected]);

  useEffect(() => {
    if (!activeTokenOptions.includes(token)) setToken(activeTokenOptions[0]);
  }, [activeTokenOptions, token]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (selectedStale) return null;
    if (mode === 'mint') {
      const depositWei = parseZeroAmount(deposit, token);
      const mintWei = parseZeroAmount(mint, 'fxUSD');
      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n)) return null;
      return () => planDepositAndMint({
        market,
        positionId: selectedKey === 'new' ? 0 : selected?.info.positionId ?? 0,
        userAddress: wallet.address!,
        depositTokenAddress: tokenAddress(token),
        depositAmount: depositWei,
        mintAmount: mintWei,
      });
    }
    if (!selected) return null;
    const repayWei = repay.toLowerCase() === 'all' ? selected.info.rawDebts : parseZeroAmount(repay, 'fxUSD');
    const withdrawWei = parseZeroAmount(withdraw, token);
    if (repayWei === null || withdrawWei === null || (repayWei === 0n && withdrawWei === 0n)) return null;
    return () => planRepayAndWithdraw({
      market: selected.market,
      positionId: selected.info.positionId,
      userAddress: wallet.address!,
      repayAmount: repayWei,
      withdrawAmount: withdrawWei,
      withdrawTokenAddress: tokenAddress(token),
    });
  }, [deposit, market, mint, mode, repay, selected, selectedKey, selectedStale, token, wallet.address, withdraw]);

  const walletAddress = wallet.address?.toLowerCase();
  const initialRead = Boolean(walletAddress)
    && (sharedPositions.walletAddress?.toLowerCase() !== walletAddress
      || (sharedPositions.status === 'loading' && sharedPositions.lastVerifiedAt === null));
  const longPoolReadUnavailable = sharedPositions.status === 'unavailable'
    || sharedPositions.failedGroups.some((group) => group.side === 'long');
  const positionReadUnavailable = Boolean(walletAddress)
    && longPoolReadUnavailable
    && positions.length === 0;
  const repayRequested = repay.trim().toLowerCase() === 'all' || (parseZeroAmount(repay, 'fxUSD') ?? 0n) > 0n;
  const withdrawalRequested = (parseZeroAmount(withdraw, token) ?? 0n) > 0n;
  const manageOperationLabel = repayRequested && withdrawalRequested
    ? 'Repay fxUSD and withdraw collateral'
    : repayRequested
      ? 'Repay fxUSD'
      : withdrawalRequested
        ? 'Withdraw collateral'
        : 'Manage debt';

  const actionCardVisible = !wallet.address
    || initialRead
    || reviewStage !== 'input'
    || (!positionReadUnavailable && (mode === 'mint' || positions.length > 0));
  const actionEditor = !wallet.address ? (
    <DisconnectedBorrowForm
      mode={mode}
      market={market}
      onMarketChange={changeMarket}
      token={token}
      tokens={activeTokenOptions}
      onTokenChange={changeToken}
      deposit={deposit}
      onDepositChange={setDeposit}
      mint={mint}
      onMintChange={setMint}
      repay={repay}
      onRepayChange={setRepay}
      withdraw={withdraw}
      onWithdrawChange={setWithdraw}
    />
  ) : mode === 'mint' ? (
    <div className="flex flex-col gap-4">
      <FormHeader
        title={selected ? `Borrow against position #${selected.info.positionId}` : 'Open a collateral position'}
        body={selected
          ? 'Choose what to add to this existing Trade position.'
          : 'Choose your starting collateral and how much fxUSD to receive.'}
      />
      <TokenSelect label="Collateral asset" value={token} options={collateralTokens} onChange={changeToken} balances={balanceSnapshot.status === 'idle' ? undefined : balanceSnapshot.balances} balanceStatus={balanceStatus} />
      <div className={styles.borrowAmountGrid}>
        <AmountField
          label={selected ? 'Collateral to add' : 'Starting collateral'}
          symbol={token}
          value={deposit}
          onChange={setDeposit}
          allowZero
          maxDecimals={tokenDecimals(token)}
          placeholder="0.00"
          balanceState={balanceStateFor(token)}
        />
        <AmountField
          label={selected ? 'Additional fxUSD to borrow' : 'fxUSD to receive'}
          symbol="fxUSD"
          value={mint}
          onChange={setMint}
          allowZero
          maxDecimals={18}
          placeholder="0.00"
        />
      </div>
      <InfoNote>{selected
        ? 'Enter collateral to make the position safer, fxUSD to borrow more, or both. Borrowed fxUSD is sent to your wallet and added to this position’s debt.'
        : 'FxAeon opens one collateralized long position and sends the borrowed fxUSD to your wallet. The review shows the resulting collateral and debt before you sign.'}</InfoNote>
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <FormHeader title="Manage debt" body="Repay fxUSD, withdraw collateral, or do both." />
      {!selected && sharedPositions.status === 'loading' && <span role="status" aria-label="Reading collateral position" className="skeleton block h-7 rounded-xl" />}
      {!selected && sharedPositions.status !== 'loading' && <p role="status" className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[12px] text-mut">Choose a position to manage debt, or switch to Borrow fxUSD to open one.</p>}
      <TokenSelect label="Receive collateral as" value={token} options={withdrawalTokens} onChange={changeToken} balances={balanceSnapshot.status === 'idle' ? undefined : balanceSnapshot.balances} balanceStatus={balanceStatus} />
      <div className={styles.borrowAmountGrid}>
        <AmountField
          label="Repay amount"
          symbol="fxUSD"
          value={repay}
          onChange={setRepay}
          allowAll
          allowZero
          maxDecimals={18}
          placeholder="0.00"
          balanceState={balanceStateFor('fxUSD')}
        />
        <AmountField
          label="Collateral to withdraw"
          symbol={token}
          value={withdraw}
          onChange={setWithdraw}
          allowZero
          maxDecimals={tokenDecimals(token)}
          placeholder="0.00"
        />
      </div>
      <InfoNote>Enter the fxUSD to repay, the collateral to receive, or both. The review shows the resulting position before you sign; withdrawing collateral can reduce its safety margin.</InfoNote>
    </div>
  );

  return (
    <AppShell title="Borrow" subtitle="Create or manage a long collateral position and borrow fxUSD.">
      <div className={`${styles.workspace} ${styles.borrowWorkspace}`}>
        <ConfirmedPositionCards />
        <nav className={`grid grid-cols-2 ${styles.productSwitch}`} aria-label="Savings and borrowing">
          <Link href="/earn" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">fxSAVE</Link>
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">Borrow fxUSD</span>
        </nav>
        {wallet.address && initialRead && (
          <LoadingRegion label="Reading borrowing positions" className="flex flex-col gap-3.5">
            <Skeleton className="h-11" />
            <Skeleton className="h-14" />
            <Skeleton className="h-72" />
          </LoadingRegion>
        )}
        {wallet.address && !initialRead && positionReadUnavailable && (
          <div role="alert" aria-live="polite" className="flex flex-col gap-3.5 rounded-2xl border border-[var(--line)] bg-[var(--warn-dim)] p-5">
            <div><p className="font-semibold text-warn">Borrowing positions are unavailable.</p><p className="mt-1 text-[12px] leading-relaxed text-mut">No current collateral or debt state was verified. Retry before reviewing a borrowing action.</p></div>
            <Button aria-label="Retry borrowing positions" onClick={() => void refreshPositions()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry position read</Button>
          </div>
        )}
        {(!wallet.address || initialRead || !positionReadUnavailable) && (
          <>
            {wallet.address && !initialRead && !positionReadUnavailable && (
              <ProtocolPositionNotice
                status={sharedPositions.status}
                failedGroups={sharedPositions.failedGroups}
                hasPositions={positions.length > 0}
                refreshing={sharedPositions.refreshing}
                onRefresh={() => void refreshPositions()}
              />
            )}
            <div className="rounded-2xl bg-[var(--surface-2,var(--input))] p-1">
              <Segmented
                value={mode}
                onChange={changeMode}
                ariaLabel="Borrow action"
                options={[
                  { value: 'mint', label: 'Borrow or add' },
                  { value: 'manage', label: 'Repay or withdraw' },
                ]}
              />
            </div>

            {wallet.address && !initialRead && !positionReadUnavailable && mode === 'mint' && (
              <>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2,var(--input))] p-1">
                  <Segmented
                    value={market}
                    onChange={changeMarket}
                    ariaLabel="Collateral market"
                    options={[
                      { value: 'ETH', label: 'ETH' },
                      { value: 'BTC', label: 'BTC' },
                    ]}
                  />
                </div>
                <PositionSelect
                  value={selectedKey}
                  positions={marketPositions}
                  allowNew
                  newLabel={`New ${market} position`}
                  onChange={changePosition}
                />
                {selected ? (
                  <PositionSummary position={selected} />
                ) : (
                  <p className="px-1 text-[12px] text-mut">A new {market} collateral position will be created.</p>
                )}
              </>
            )}

            {wallet.address && !initialRead && !positionReadUnavailable && mode === 'manage' && positions.length === 0 ? (
              <EmptyState
                icon={Coins}
                title="No borrowing positions"
                body="Create an ETH or BTC collateral position to borrow fxUSD."
                action={<Button onClick={() => { setSelectedKey('new'); changeMode('mint'); }}>Start borrowing</Button>}
              />
            ) : wallet.address && !initialRead && !positionReadUnavailable && mode === 'manage' ? (
              <>
                <PositionSelect value={selectedKey} positions={positions} onChange={changePosition} />
                {selected && <PositionSummary position={selected} />}
              </>
            ) : null}

            {actionCardVisible && (
              <Card
                data-flow-stage={reviewStage}
                className={`${styles.focusCard} ${reviewStage === 'input' ? '' : styles.reviewInlineCard} p-5`}
              >
                <ActionReview
                  key={reviewRevision}
                  surface="content"
                  planBuilder={planBuilder}
                  label={mode === 'mint'
                    ? selected ? 'Review position update' : 'Review new position'
                    : 'Review changes'}
                  operationLabel={mode === 'mint'
                    ? selected ? 'Update collateral position' : 'Open collateral position'
                    : manageOperationLabel}
                  draftActionKey={draftActionKey}
                  draftResumePath="/borrow"
                  draftState={draftState}
                  resumeReview={resumeReview}
                  decisionBefore={decisionBefore}
                  editor={actionEditor}
                  onStageChange={setReviewStage}
                  onComplete={refreshAfterAction}
                />
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function DisconnectedBorrowForm({
  mode,
  market,
  onMarketChange,
  token,
  tokens,
  onTokenChange,
  deposit,
  onDepositChange,
  mint,
  onMintChange,
  repay,
  onRepayChange,
  withdraw,
  onWithdrawChange,
}: {
  mode: BorrowMode;
  market: UiMarket;
  onMarketChange: (market: UiMarket) => void;
  token: UiToken;
  tokens: readonly UiToken[];
  onTokenChange: (token: UiToken) => void;
  deposit: string;
  onDepositChange: (value: string) => void;
  mint: string;
  onMintChange: (value: string) => void;
  repay: string;
  onRepayChange: (value: string) => void;
  withdraw: string;
  onWithdrawChange: (value: string) => void;
}) {
  const disconnectedBalance = { status: 'disconnected' as const };
  return (
    <div className={`${styles.disconnectedBorrowForm} flex flex-col gap-4`}>
      {mode === 'mint' ? (
        <div className={`${styles.disconnectedBorrowFields} flex flex-col gap-4`}>
          <FormHeader title="Open a collateral position" body="Choose your starting collateral and how much fxUSD to receive." />
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2,var(--input))] p-1">
            <Segmented value={market} onChange={onMarketChange} ariaLabel="Collateral market" options={[{ value: 'ETH', label: 'ETH' }, { value: 'BTC', label: 'BTC' }]} />
          </div>
          <TokenSelect label="Collateral asset" value={token} options={tokens} onChange={onTokenChange} balanceStatus="disconnected" />
          <div className={styles.borrowAmountGrid}>
          <AmountField label="Starting collateral" symbol={token} value={deposit} onChange={onDepositChange} allowZero maxDecimals={tokenDecimals(token)} placeholder="0.00" balanceState={disconnectedBalance} />
            <AmountField label="fxUSD to receive" symbol="fxUSD" value={mint} onChange={onMintChange} allowZero maxDecimals={18} placeholder="0.00" />
          </div>
          <InfoNote>Connect a wallet to load balances and prepare the exact collateral and debt route.</InfoNote>
        </div>
      ) : (
        <div className={`${styles.disconnectedBorrowFields} flex flex-col gap-4`}>
          <FormHeader title="Manage debt" body="Repay fxUSD, withdraw collateral, or do both." />
          <p className="rounded-xl bg-[var(--warn-dim)] px-3 py-2 text-[11px] leading-relaxed text-warn">Connect a wallet to load a collateral position.</p>
          <TokenSelect label="Receive collateral as" value={token} options={tokens} onChange={onTokenChange} balanceStatus="disconnected" />
          <div className={styles.borrowAmountGrid}>
            <AmountField label="Repay amount" symbol="fxUSD" value={repay} onChange={onRepayChange} allowAll allowZero maxDecimals={18} placeholder="0.00" balanceState={disconnectedBalance} />
            <AmountField label="Collateral to withdraw" symbol={token} value={withdraw} onChange={onWithdrawChange} allowZero maxDecimals={tokenDecimals(token)} placeholder="0.00" />
          </div>
          <InfoNote>Connect a wallet to verify the selected position and prepare its repay or withdrawal route.</InfoNote>
        </div>
      )}
    </div>
  );
}

function PositionSelect({
  value,
  positions,
  allowNew = false,
  newLabel = 'New collateral position',
  onChange,
}: {
  value: string;
  positions: UiPosition[];
  allowNew?: boolean;
  newLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={`mb-2 block ${styles.eyebrow}`}>Collateral position</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[56px] w-full rounded-2xl border border-[var(--line)] bg-[var(--input)] px-4 text-[16px] font-semibold outline-none focus:border-mint"
      >
        {allowNew && <option value="new">{newLabel}</option>}
        {positions.map((position) => (
          <option key={positionKey(position)} value={positionKey(position)}>
            Trade position #{position.info.positionId} · {position.market} · {formatPositionCollateral(position)} collateral · {formatPositionDebt(position)} debt
          </option>
        ))}
      </select>
    </label>
  );
}

function PositionSummary({ position }: { position: UiPosition }) {
  const { prices } = useUsdPrices();
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionCollateralDecimals(position),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionDebtDecimals(position),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
  const missingPrice = '—';
  const collateralUsd = valuation.collateralUsdCents === null ? missingPrice : formatUsdCents(valuation.collateralUsdCents);
  const debtUsd = valuation.debtUsdCents === null ? missingPrice : formatUsdCents(valuation.debtUsdCents);
  const netEquity = valuation.netEquityUsdCents === null ? missingPrice : formatUsdCents(valuation.netEquityUsdCents);
  return (
    <Card className={`${styles.summaryCard} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={styles.eyebrow}>Position</p>
          <h2 className="text-display mt-2 text-[19px] font-semibold">{position.market} collateral · #{position.info.positionId}</h2>
        </div>
        <span className="rounded-lg bg-[var(--mint-dim)] px-2 py-1 text-[11px] font-semibold text-mint">Long</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Est. net equity" value={netEquity} />
        <Metric label="Collateral value" value={`${formatPositionCollateral(position)} · ${collateralUsd}`} />
        <Metric label="Debt value" value={`${formatPositionDebt(position)} · ${debtUsd}`} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-mut">Display estimate: collateral USD minus debt USD, not a close quote or liquidation value.</p>
    </Card>
  );
}

function FormHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.formHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={`mt-1 ${styles.supportCopy}`}>{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${styles.metric} p-3`}>
      <span className="block text-[11px] text-mut">{label}</span>
      <span className="mt-1 block truncate text-[13px] font-semibold tabular-nums" title={value}>{value}</span>
    </div>
  );
}

function formatPositionCollateral(position: UiPosition): string {
  return `${formatAmount(position.info.rawColls, positionCollateralDecimals(position))} ${position.info.rawCollsToken}`;
}

function formatPositionDebt(position: UiPosition): string {
  return `${formatAmount(position.info.rawDebts, positionDebtDecimals(position))} ${position.info.rawDebtsToken}`;
}
