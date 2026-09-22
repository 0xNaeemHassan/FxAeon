'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/ui';
import { formatUnits } from 'viem';
import TokenIcon from '@/components/TokenIcon';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import { MetricRows, PageHeading, ProductNav, ProductSurface, StatusNotice } from '@/components/ProductUI';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { calculateNativeMax } from '@/lib/fx/nativeMax';
import { estimatePlannedRouteCost } from '@/lib/fx';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { useProtocolPositions } from '@/components/ProtocolPositionProvider';
import { ProtocolPositionNotice } from '@/components/ProtocolPositionCard';
import { ConfirmedPositionCards } from '@/components/ConfirmedPositionCards';
import { AmountField, Segmented, TokenSelect, useWalletTokenBalances } from '@/components/ProtocolForm';
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
import presentation from '@/components/BorrowWorkspace.module.css';
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';
import { priceKeyForSymbol } from '@/lib/prices';
import { resetTransactionAmounts } from '@/lib/transactionState';
import { ValueOrSkeleton } from '@/components/MissingValue';

type BorrowMode = 'mint' | 'manage';
type ManagementAction = 'none' | 'add' | 'borrow' | 'repay' | 'withdraw' | 'combined';

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
  const [managementAction, setManagementAction] = useState<ManagementAction>('none');
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
    setManagementAction('none');
    setMarket(nextMarket);
    setSelectedKey('new');
    resetTransactionContext(collateralTokensForMarket(nextMarket)[0]);
  }, [resetTransactionContext]);

  const changePosition = useCallback((nextKey: string) => {
    const next = positions.find((position) => positionKey(position) === nextKey);
    if (!next) return;
    setManagementAction('none');
    setMode('manage');
    setMarket(next.market);
    setSelectedKey(nextKey);
    resetTransactionContext(collateralTokensForMarket(next.market)[0]);
  }, [positions, resetTransactionContext]);

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
      setManagementAction('none');
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
    setManagementAction('combined');
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
    setManagementAction('combined');
    setMarket(requested.market);
    setSelectedKey(positionKey(requested));
    resetTransactionContext(collateralTokensForMarket(requested.market)[0]);
  }, [positions, resetTransactionContext, sharedPositions.walletAddress, wallet.address]);

  useEffect(() => {
    setSelectedKey((current) => {
      // Never retarget already-entered amounts when a selected position vanishes.
      if (mode === 'mint') return current || 'new';
      return current && current !== 'new' ? current : positions[0] ? positionKey(positions[0]) : '';
    });
  }, [mode, positions]);

  useEffect(() => {
    if (mode === 'manage' && selected) setMarket(selected.market);
  }, [mode, selected]);

  useEffect(() => {
    if (!activeTokenOptions.includes(token)) setToken(activeTokenOptions[0]);
  }, [activeTokenOptions, token]);

  const [nativeMaxPending, setNativeMaxPending] = useState(false);
  const [nativeMaxError, setNativeMaxError] = useState<string | null>(null);
  const maxRequest = useRef(0);
  const maxMounted = useRef(true);
  const maxContext = useRef('');
  const maxContextKey = JSON.stringify([wallet.address, wallet.chainId, market, selectedKey, token, deposit, mint, balanceSnapshot.balances.ETH?.amount]);
  maxContext.current = maxContextKey;
  useEffect(() => { maxMounted.current = true; return () => { maxMounted.current = false; maxRequest.current += 1; }; }, []);
  useEffect(() => { maxRequest.current += 1; setNativeMaxPending(false); setNativeMaxError(null); }, [maxContextKey]);
  const resolveNativeMax = useCallback(async () => {
    const balance = balanceSnapshot.balances.ETH;
    if (token !== 'ETH' || !wallet.address || nativeMaxPending || selectedStale || selectedKey !== 'new' && !selected
      || balance?.status !== 'ready' || !balance.amount) return;
    const balanceWei = parseZeroAmount(balance.amount, 'ETH');
    const debtWei = parseZeroAmount(mint, 'fxUSD');
    if (!balanceWei || debtWei === null) return;
    const request = ++maxRequest.current;
    const context = maxContext.current;
    const current = () => maxMounted.current && request === maxRequest.current && context === maxContext.current;
    setNativeMaxPending(true); setNativeMaxError(null);
    try {
      const maximum = await calculateNativeMax({ balanceWei, initialCandidateWei: parseZeroAmount(deposit, 'ETH') ?? undefined,
        buildRoutes: async (amountWei) => {
          const route = await planDepositAndMint({ market, positionId: selectedKey === 'new' ? 0 : selected!.info.positionId,
            userAddress: wallet.address!, depositTokenAddress: tokenAddress('ETH'), depositAmount: amountWei, mintAmount: debtWei });
          return Array.isArray(route) ? route : [route];
        },
        estimateRoutes: (routes) => Promise.all(routes.map((route) => estimatePlannedRouteCost(route))), isCurrent: current,
      });
      if (!current()) return;
      setNativeMaxPending(false);
      setDeposit(formatUnits(maximum, 18));
    } catch {
      if (current()) setNativeMaxError('Max is unavailable until current network fees are verified. Retry or enter an amount.');
    } finally { if (current()) setNativeMaxPending(false); }
  }, [balanceSnapshot.balances.ETH, deposit, market, mint, nativeMaxPending, selected, selectedKey, selectedStale, token, wallet.address]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (selectedStale || selectedKey !== 'new' && !selected) return null;
    if (mode === 'mint') {
      const depositWei = parseZeroAmount(deposit, token);
      const mintWei = parseZeroAmount(mint, 'fxUSD');
      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n) || selectedKey === 'new' && depositWei === 0n) return null;
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

  const newPosition = mode === 'mint' && selectedKey === 'new';
  const view = newPosition ? 'new' : 'positions';
  const chooseView = (next: 'new' | 'positions') => {
    setManagementAction('none');
    if (next === 'new') {
      setMode('mint'); setSelectedKey('new'); resetTransactionContext(collateralTokensForMarket(market)[0]);
    } else {
      const first = selected ?? positions[0];
      setMode('manage'); setSelectedKey(first ? positionKey(first) : '');
      if (first) setMarket(first.market);
      resetTransactionContext(collateralTokensForMarket(first?.market ?? market)[0]);
    }
  };
  const chooseManagement = (action: ManagementAction) => {
    if (!selected || selectedStale) return;
    setManagementAction(action);
    if (action !== 'combined') changeMode(action === 'add' || action === 'borrow' ? 'mint' : 'manage');
  };
  const showDeposit = newPosition || mode === 'mint' && (managementAction === 'add' || managementAction === 'combined');
  const showMint = newPosition || mode === 'mint' && (managementAction === 'borrow' || managementAction === 'combined');
  const showRepay = mode === 'manage' && (managementAction === 'repay' || managementAction === 'combined');
  const showWithdraw = mode === 'manage' && (managementAction === 'withdraw' || managementAction === 'combined');
  const picker = <TokenSelect compact label={mode === 'manage' ? 'Receive collateral as' : 'Collateral asset'} value={token}
    options={activeTokenOptions} onChange={changeToken} balances={wallet.address ? balanceSnapshot.balances : undefined}
    balanceStatus={wallet.address ? balanceStatus : 'disconnected'} />;
  const actionEditor = <div className={presentation.editor}>
    <h2 className={presentation.formTitle}>{newPosition ? 'Open a collateral position' : mode === 'mint' ? 'Add collateral or borrow' : 'Manage debt'}</h2>
    {newPosition && <Segmented value={market} onChange={changeMarket} ariaLabel="Collateral market"
      options={[{ value: 'ETH', label: 'ETH', icon: <TokenIcon symbol="ETH" size={21} /> }, { value: 'BTC', label: 'BTC', icon: <TokenIcon symbol="WBTC" size={21} /> }]} />}
    {showDeposit && <AmountField label={newPosition ? 'Starting collateral' : 'Collateral to add'} symbol={token} value={deposit}
      onChange={(value) => { setNativeMaxError(null); setDeposit(value); }} allowZero maxDecimals={tokenDecimals(token)}
      balanceState={balanceStateFor(token)} tokenSelector={picker}
      maxAmount={token === 'ETH' ? null : undefined} onMax={token === 'ETH' ? resolveNativeMax : undefined}
      maxPending={token === 'ETH' && nativeMaxPending} constraintError={token === 'ETH' ? nativeMaxError : undefined} />}
    {showMint && <AmountField label={newPosition ? 'fxUSD to borrow' : 'Additional fxUSD to borrow'} hint="Debt added" symbol="fxUSD" value={mint}
      onChange={setMint} allowZero maxDecimals={18} showPercentages={false} showMax={false} />}
    {showRepay && <AmountField label="Repay amount" symbol="fxUSD" value={repay} onChange={setRepay} allowAll allowZero maxDecimals={18}
      balanceState={balanceStateFor('fxUSD')} hint={selected ? `Debt: ${formatPositionDebt(selected)}` : undefined} />}
    {showWithdraw && <AmountField label="Collateral to withdraw" symbol={token} value={withdraw} onChange={setWithdraw}
      allowZero maxDecimals={tokenDecimals(token)} showMax={false} showPercentages={false} tokenSelector={picker} />}
    {mode === 'mint' ? <p className={presentation.helper}>Borrowing fees are deducted from the fxUSD you receive. The review shows debt and receipt amounts separately.</p>
      : <p className={presentation.helper}>The review shows the position changes before you sign. Withdrawing collateral can increase liquidation risk.</p>}
    {!newPosition && managementAction !== 'combined' && <button type="button" className={presentation.combined} onClick={() => setManagementAction('combined')}>
      {mode === 'mint' ? 'Add collateral and borrow together' : 'Repay and withdraw together'}
    </button>}
  </div>;
  const showAction = newPosition || Boolean(selected && managementAction !== 'none') || reviewStage !== 'input';
  const reviewLabel = mode === 'mint' ? 'Review borrowing' : repayRequested && !withdrawalRequested ? 'Review repayment' : 'Review position changes';

  return <AppShell>
    <div className={presentation.workspace}>
      <PageHeading title="Earn" />
      <ProductNav current="borrow" />
      <ConfirmedPositionCards />
      {reviewStage === 'input' && <div className={presentation.viewTabs}>
        <Segmented value={view} onChange={chooseView} ariaLabel="Borrow workspace" options={[
          { value: 'new', label: 'New position' }, { value: 'positions', label: 'Your positions' },
        ]} />
      </div>}
      {wallet.address && initialRead && <StatusNotice>Reading your collateral positions…</StatusNotice>}
      {wallet.address && !initialRead && positionReadUnavailable && <StatusNotice title="Borrowing positions are unavailable" tone="warning"
        action={<button type="button" onClick={() => void refreshPositions()}>Retry</button>}>Retry before continuing.</StatusNotice>}
      {wallet.address && !initialRead && !positionReadUnavailable && <ProtocolPositionNotice status={sharedPositions.status}
        failedGroups={sharedPositions.failedGroups} hasPositions={positions.length > 0} refreshing={sharedPositions.refreshing} onRefresh={() => void refreshPositions()} compact />}
      {view === 'positions' && reviewStage === 'input' && <>
        {!wallet.address ? <ProductSurface><p className={presentation.helper}>Connect the wallet that holds your collateral position.</p><ConnectWalletButton className="button button-primary mt-4 w-full">Connect wallet</ConnectWalletButton></ProductSurface>
          : !initialRead && !positionReadUnavailable && positions.length === 0 ? <ProductSurface className={presentation.empty}>
            <h2>No borrowing positions</h2><p className={presentation.helper}>Open an ETH or BTC collateral position to borrow fxUSD.</p>
            <button type="button" className="button button-primary" onClick={() => chooseView('new')}>Start borrowing</button>
          </ProductSurface> : selected ? <ProductSurface className={presentation.position}>
            {positions.length > 1 && <PositionSelect value={selectedKey} positions={positions} onChange={changePosition} />}
            <PositionSummary position={selected} />
            <div className={presentation.management} role="group" aria-label="Manage collateral position">
              {([{ value: 'add', label: 'Add collateral' }, { value: 'borrow', label: 'Borrow more' }, { value: 'repay', label: 'Repay debt' }, { value: 'withdraw', label: 'Withdraw collateral' }] as const).map((action) =>
                <button key={action.value} type="button" aria-pressed={managementAction === action.value} disabled={selectedStale || initialRead}
                  onClick={() => chooseManagement(action.value)}>{action.label}</button>)}
            </div>
          </ProductSurface> : !initialRead && !positionReadUnavailable ? <StatusNotice title="Choose a current position" tone="warning">The selected position is no longer available. Choose New position to start another one.</StatusNotice> : null}
      </>}
      {showAction && <ProductSurface data-flow-stage={reviewStage} className={presentation.action}>
        <ActionReview key={reviewRevision} surface="content" planBuilder={initialRead || positionReadUnavailable ? null : planBuilder}
          label={reviewLabel} operationLabel={mode === 'mint' ? selected ? 'Update collateral position' : 'Open collateral position' : manageOperationLabel}
          draftActionKey={draftActionKey} draftResumePath="/borrow" draftState={draftState} resumeReview={resumeReview}
          decisionBefore={decisionBefore} editor={actionEditor} onStageChange={setReviewStage} onComplete={refreshAfterAction} />
      </ProductSurface>}
    </div>
  </AppShell>;
}

function PositionSelect({ value, positions, onChange }: { value: string; positions: UiPosition[]; onChange: (value: string) => void }) {
  return <label className={presentation.positionSelect}>
    <span>Collateral position</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {positions.map((position) => <option key={positionKey(position)} value={positionKey(position)}>
        {position.market} position #{position.info.positionId} · {formatPositionDebt(position)} debt
      </option>)}
    </select>
  </label>;
}
function PositionSummary({ position }: { position: UiPosition }) {
  const snapshot = useUsdPrices();
  const prices = freshDisplayPrices(snapshot);
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = calculatePositionUsdValuation({ collateralRaw: position.info.rawColls, collateralDecimals: positionCollateralDecimals(position),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined, debtRaw: position.info.rawDebts, debtDecimals: positionDebtDecimals(position), debtPrice: debtKey ? prices[debtKey] : undefined });
  const ltv = valuation.collateralUsdCents !== null && valuation.collateralUsdCents > 0n && valuation.debtUsdCents !== null
    ? `${(Number(valuation.debtUsdCents * 1000n / valuation.collateralUsdCents) / 10).toFixed(1)}%` : '—';
  return <div className={presentation.positionSummary}>
    <div className={presentation.positionIdentity}><TokenIcon symbol={position.market === 'BTC' ? 'WBTC' : 'ETH'} size={34} />
      <div><h2>{position.market} position #{position.info.positionId}</h2><p>Ethereum</p></div></div>
    <MetricRows label="Current collateral position" rows={[
      { label: 'Collateral', value: formatPositionCollateral(position), detail: valuation.collateralUsdCents !== null ? `≈ ${formatUsdCents(valuation.collateralUsdCents)}` : 'Value unavailable' },
      { label: 'Debt', value: formatPositionDebt(position), detail: valuation.debtUsdCents !== null ? `≈ ${formatUsdCents(valuation.debtUsdCents)}` : 'Value unavailable' },
      { label: 'Net position value', value: <ValueOrSkeleton value={valuation.netEquityUsdCents !== null ? formatUsdCents(valuation.netEquityUsdCents) : '—'} status={snapshot.status === 'loading' ? 'loading' : 'unavailable'} />, emphasis: true },
      { label: 'Loan-to-value', value: ltv },
    ]} />
  </div>;
}
function formatPositionCollateral(position: UiPosition): string { return `${formatAmount(position.info.rawColls, positionCollateralDecimals(position))} ${position.info.rawCollsToken}`; }
function formatPositionDebt(position: UiPosition): string { return `${formatAmount(position.info.rawDebts, positionDebtDecimals(position))} ${position.info.rawDebtsToken}`; }
