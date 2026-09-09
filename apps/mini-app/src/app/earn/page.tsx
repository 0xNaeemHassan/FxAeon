'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Clock3, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { AmountField, InfoNote, Segmented, SlippageField, ToggleRow, TokenSelect, useWalletTokenBalances, type TokenBalanceMap } from '@/components/ProtocolForm';
import { useUsdPrices } from '@/components/PriceProvider';
import { formatUsd } from '@/lib/prices';
import { fxSaveUsdValue, normalizedFxSaveAssetsWei } from '@/lib/fxSaveUnits';
import {
  assertConfiguredPublicClientChain,
  getFxReadFacade,
  withReadDeadline,
  MAX_FX_SLIPPAGE_PERCENT,
  planDepositFxSave,
  planRedeem,
  planWithdrawFxSave,
  restoreSignatureRequiredDraftFromSearch,
  signatureDraftIdFromSearch,
  type SignatureDraftState,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import { userSafeError } from '@/lib/errors';
import { resetTransactionAmounts } from '@/lib/transactionState';
import { claimAvailability, cooldownRefreshDelayMs, createEarnReadGuard } from '@/lib/earnState';
import { fetchFxSaveApy, type FxSaveApyResponse } from '@/lib/fxSaveApy';
import { formatAmount, parseAmount, type SaveToken } from '@/app/trade/fxUi';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import styles from '@/components/FlowWorkspace.module.css';

type EarnMode = 'deposit' | 'withdraw' | 'claim';

const EARN_DRAFT_SCOPES = [
  { mode: 'deposit', operation: 'depositFxSave', actionKey: 'earn:deposit' },
  { mode: 'withdraw', operation: 'withdrawFxSave', actionKey: 'earn:withdraw' },
  { mode: 'claim', operation: 'getRedeemTx', actionKey: 'earn:claim' },
] as const;

function isEarnMode(value: unknown): value is EarnMode {
  return value === 'deposit' || value === 'withdraw' || value === 'claim';
}

function isSaveToken(value: unknown): value is SaveToken {
  return value === 'fxUSD' || value === 'usdc' || value === 'fxUSDBasePool';
}

function isEarnResumePath(value: string): boolean {
  try {
    return new URL(value, 'https://fxaeon.local').pathname === '/earn';
  } catch {
    return false;
  }
}

/**
 * Restore only the small, primitive form snapshot written by ActionReview.
 * The draft id is never enough on its own: operation, stable action identity,
 * Ethereum scope, wallet, and same-origin route must all match first.
 */
function restoreEarnDraft(search: string, walletAddress: string): SignatureDraftState | undefined {
  for (const scope of EARN_DRAFT_SCOPES) {
    const restored = restoreSignatureRequiredDraftFromSearch(search, {
      walletAddress: walletAddress as `0x${string}`,
      chainId: 1,
      operation: scope.operation,
      actionKey: scope.actionKey,
    });
    if (!restored || !isEarnResumePath(restored.draft.resumePath)) continue;
    const state = restored.formState;
    if (
      state.mode !== scope.mode
      || !isEarnMode(state.mode)
      || !isSaveToken(state.token)
      || (state.amount !== undefined && typeof state.amount !== 'string')
      || (state.shares !== undefined && typeof state.shares !== 'string')
      || (state.slippage !== undefined && typeof state.slippage !== 'string')
      || (state.instant !== undefined && typeof state.instant !== 'boolean')
    ) continue;
    return state;
  }
  return undefined;
}

function labelToken(token: SaveToken): string {
  return tokenSymbol(token);
}

export default function EarnPage() {
  const wallet = usePrivyWallet();
  const [mode, setMode] = useState<EarnMode>('deposit');
  const [token, setToken] = useState<SaveToken>('fxUSD');
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  const [instant, setInstant] = useState(true);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<SaveConfig | null>(null);
  const [data, setData] = useState<SaveData | null>(null);
  const [readWarnings, setReadWarnings] = useState<string[]>([]);
  const [fxSaveApy, setFxSaveApy] = useState<FxSaveApyResponse | null>(null);
  const [fxSaveApyStatus, setFxSaveApyStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const restoredDraftIdRef = useRef<string | null>(null);
  const contextAppliedRef = useRef(false);
  const previousWalletContextRef = useRef<string | null>(null);
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
  const readGuard = useRef(createEarnReadGuard());
  const dataRef = useRef<SaveData | null>(null);
  const configRef = useRef<SaveConfig | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { configRef.current = config; }, [config]);
  // fxSAVE routes are Ethereum-only even when the connected wallet is
  // currently displaying another supported chain. Read the selected address
  // against Ethereum's reviewed public client, not wallet.chainId.
  const balanceSnapshot = useWalletTokenBalances(wallet.address, 1);
  const saveBalances = useMemo<TokenBalanceMap | undefined>(() => {
    if (balanceSnapshot.status === 'idle') return undefined;
    return {
      ...balanceSnapshot.balances,
      usdc: balanceSnapshot.balances.USDC,
    };
  }, [balanceSnapshot.balances, balanceSnapshot.status]);
  const saveBalanceStatus = wallet.address
    ? (balanceSnapshot.status === 'idle' ? 'loading' : balanceSnapshot.status)
    : undefined;
  const saveBalanceState = wallet.address
    ? saveBalances?.[token] ?? { status: saveBalanceStatus ?? 'loading' as const }
    : undefined;

  const resetEarnContext = useCallback((nextMode: EarnMode = 'deposit', nextToken: SaveToken = 'fxUSD') => {
    const defaults = resetTransactionAmounts();
    setMode(nextMode);
    setToken(nextToken);
    setAmount(defaults.amount);
    setShares(defaults.shares);
    setInstant(true);
    setReviewStage('input');
    setReviewRevision((revision) => revision + 1);
  }, []);

  const changeMode = useCallback((nextMode: EarnMode) => {
    resetEarnContext(nextMode);
  }, [resetEarnContext]);

  const changeToken = useCallback((nextToken: SaveToken) => {
    resetEarnContext(mode, nextToken);
  }, [mode, resetEarnContext]);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    if (previous !== null && previous !== context && (walletChanged || chainChanged)) resetEarnContext();
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetEarnContext, wallet.address, wallet.chainId]);

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  useEffect(() => {
    if (contextAppliedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('fxDraft')) return;
    const nextMode = params.get('mode');
    const nextToken = params.get('token');
    if (nextMode === 'deposit' || nextMode === 'withdraw' || nextMode === 'claim') setMode(nextMode);
    if (isSaveToken(nextToken)) setToken(nextToken);
    contextAppliedRef.current = true;
  }, []);

  // History links carry only an opaque local draft id. Consume it once the
  // matching wallet is available, then remove it with replaceState so a
  // reload cannot repeatedly reapply an old form snapshot.
  useEffect(() => {
    if (typeof window === 'undefined' || !wallet.address || wallet.chainId !== 1) return;
    const draftId = signatureDraftIdFromSearch(window.location.search);
    if (!draftId || restoredDraftIdRef.current === draftId) return;
    const state = restoreEarnDraft(window.location.search, wallet.address);
    restoredDraftIdRef.current = draftId;
    if (!state) return;
    const restoredMode = state.mode;
    if (!isEarnMode(restoredMode)) return;
    setMode(restoredMode);
    if (isSaveToken(state.token)) setToken(state.token);
    if (typeof state.amount === 'string') setAmount(state.amount);
    if (typeof state.shares === 'string') setShares(state.shares);
    if (typeof state.instant === 'boolean') setInstant(state.instant);
    if (typeof state.slippage === 'string') setSlippage(state.slippage);
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
  }, [wallet.address, wallet.chainId]);

  const draftState = useMemo<SignatureDraftState>(() => ({
    mode,
    token,
    amount,
    shares,
    instant,
    slippage,
  }), [amount, instant, mode, shares, slippage, token]);

  // APY is display-only data from the official f(x) feed. It is independent
  // from SDK reads and can never affect a transaction plan or review.
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | null = null;

    const loadApy = () => {
      // Do not create network work for a hidden/offline tab. The recovery
      // events below provide one retry when the route becomes usable again.
      if (disposed || inFlight || document.visibilityState !== 'visible' || !navigator.onLine) return;
      inFlight = true;
      controller = new AbortController();
      setFxSaveApyStatus('loading');
      void fetchFxSaveApy(controller.signal)
        .then((snapshot) => {
          if (disposed || controller?.signal.aborted) return;
          setFxSaveApy(snapshot);
          setFxSaveApyStatus('ready');
        })
        .catch(() => {
          if (disposed || controller?.signal.aborted) return;
          setFxSaveApyStatus('unavailable');
        })
        .finally(() => {
          inFlight = false;
          controller = null;
        });
    };

    loadApy();
    const suspend = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) controller?.abort();
    };
    const recover = () => {
      suspend();
      loadApy();
    };
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    window.addEventListener('offline', suspend);
    return () => {
      disposed = true;
      controller?.abort();
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', suspend);
    };
  }, []);

  const load = useCallback(async (force = false) => {
    const request = readGuard.current.begin(force);
    if (request === null) return;
    const address = wallet.address;
    setLoading(true);
    setError('');
    try {
      await withReadDeadline(assertConfiguredPublicClientChain(1));
      const sdk = getFxReadFacade();
      if (!address) {
        const result = await Promise.allSettled([sdk.getFxSaveConfig({})]);
        if (!readGuard.current.isCurrent(request)) return;
        if (result[0].status === 'fulfilled') {
          setConfig(result[0].value);
          setError('');
        } else {
          setError(userSafeError(result[0].reason, ''));
        }
        setData(null);
        setReadWarnings([]);
        return;
      }
      const [nextConfig, balance, redeemStatus, claimable] = await Promise.allSettled([
        sdk.getFxSaveConfig({}),
        sdk.getFxSaveBalance({ userAddress: address }),
        sdk.getFxSaveRedeemStatus({ userAddress: address }),
        sdk.getFxSaveClaimable({ userAddress: address }),
      ]);
      if (!readGuard.current.isCurrent(request)) return;
      const previous = dataRef.current?.walletAddress?.toLowerCase() === address.toLowerCase() ? dataRef.current : null;
      const nextConfigValue = nextConfig.status === 'fulfilled' ? nextConfig.value : configRef.current;
      const nextData: SaveData = {
        walletAddress: address,
        balance: balance.status === 'fulfilled' ? balance.value : previous?.balance ?? null,
        redeemStatus: redeemStatus.status === 'fulfilled' ? redeemStatus.value : previous?.redeemStatus ?? null,
        claimable: claimable.status === 'fulfilled' ? claimable.value : previous?.claimable ?? null,
      };
      setConfig(nextConfigValue);
      setData(nextData);
      const warnings: string[] = [];
      setReadWarnings(warnings);
      if (nextData.balance || nextData.redeemStatus || nextData.claimable) setError('');
      else setError('');
    } catch (cause) {
      if (!readGuard.current.isCurrent(request)) return;
      setError(userSafeError(cause, ''));
    } finally {
      readGuard.current.finish(request);
      if (readGuard.current.isCurrent(request)) setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => {
    const guard = readGuard.current;
    guard.invalidate();
    guard.activate();
    void load(true);
    return () => guard.invalidate();
  }, [load]);

  const walletData = data?.walletAddress.toLowerCase() === wallet.address?.toLowerCase() ? data : null;
  const claimable = walletData?.claimable;
  const cooldownState = claimable ?? walletData?.redeemStatus;
  useEffect(() => {
    if (!walletData || !cooldownState || cooldownState.isCooldownComplete || !cooldownState.hasPendingRedeem) return;
    const delay = cooldownRefreshDelayMs(cooldownState.redeemableAt);
    if (delay === null) return;
    const refreshWhenForeground = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const timer = window.setTimeout(refreshWhenForeground, delay);
    window.addEventListener('focus', refreshWhenForeground);
    document.addEventListener('visibilitychange', refreshWhenForeground);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshWhenForeground);
      document.removeEventListener('visibilitychange', refreshWhenForeground);
    };
  }, [cooldownState, load, walletData]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (mode === 'claim') {
      if (!claimAvailability(walletData?.claimable).canReview) return null;
      return () => planRedeem({ userAddress: wallet.address! });
    }
    if (mode === 'deposit') {
      const amountWei = parseAmount(amount, token === 'usdc' ? 'USDC' : token === 'fxUSDBasePool' ? 'fxUSDBasePool' : 'fxUSD');
      if (!amountWei) return null;
      const slippageValue = Number(slippage);
      if (token !== 'fxUSDBasePool' && (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT)) return null;
      return () => planDepositFxSave({
        userAddress: wallet.address!,
        tokenIn: token,
        amount: amountWei,
        slippage: token === 'fxUSDBasePool' ? undefined : slippageValue,
      });
    }
    const sharesWei = shares.toLowerCase() === 'all'
      ? walletData?.balance?.balanceWei ?? null
      : parseAmount(shares, 'fxSAVE');
    if (!sharesWei || !walletData?.balance || sharesWei > walletData.balance.balanceWei) return null;
    const slippageValue = Number(slippage);
    if (instant && token !== 'fxUSDBasePool' && (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT)) return null;
    return () => planWithdrawFxSave({
      userAddress: wallet.address!,
      tokenOut: token,
      amount: sharesWei,
      instant: token === 'fxUSDBasePool' ? false : instant,
      slippage: instant && token !== 'fxUSDBasePool' ? slippageValue : undefined,
    });
  }, [amount, instant, mode, shares, slippage, token, wallet.address, walletData]);

  return (
    <AppShell title="Earn" subtitle="Deposit, withdraw, and claim fxSAVE.">
      <div className={`${styles.workspace} ${styles.earnWorkspace}`}>
        <nav className={`grid grid-cols-2 ${styles.productSwitch}`} aria-label="Savings and borrowing">
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">fxSAVE</span>
          <Link href="/borrow" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">Borrow fxUSD</Link>
        </nav>
        {!wallet.address ? (
          <>
            <FxSaveApyCard value={fxSaveApy} status={fxSaveApyStatus} />
            <div className="rounded-2xl bg-[var(--surface-2,var(--input))] p-1">
              <Segmented
                value={mode}
                onChange={changeMode}
                ariaLabel="fxSAVE action"
                options={[
                  { value: 'deposit', label: 'Deposit' },
                  { value: 'withdraw', label: 'Withdraw' },
                  { value: 'claim', label: 'Claim' },
                ]}
              />
            </div>
            <Card data-flow-stage={reviewStage} className={`${styles.focusCard} ${styles.disconnectedEarnCard} p-5`}>
              {reviewStage === 'input' && <DisconnectedEarnForm
                mode={mode}
                token={token}
                onTokenChange={changeToken}
                amount={amount}
                onAmountChange={setAmount}
                shares={shares}
                onSharesChange={setShares}
                instant={instant}
                onInstantChange={setInstant}
                slippage={slippage}
                onSlippageChange={setSlippage}
                config={config}
              />}
              <ActionReview
                planBuilder={planBuilder}
                disabled={false}
                label={mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review withdrawal' : 'Review deposit'}
                operationLabel={mode === 'claim' ? 'Claim fxSAVE redemption' : mode === 'withdraw' ? 'Withdraw fxSAVE' : 'Deposit into fxSAVE'}
                draftActionKey={mode === 'claim' ? 'earn:claim' : mode === 'withdraw' ? 'earn:withdraw' : 'earn:deposit'}
                draftResumePath="/earn"
                draftState={draftState}
                resumeReview={resumeReview}
                onStageChange={setReviewStage}
              />
            </Card>
            {config && <VaultDetails config={config} />}
          </>
        ) : loading && !walletData ? (
          <LoadingRegion label="Reading fxSAVE state" className="flex flex-col gap-3.5">
            <Skeleton className="h-44" />
            <Skeleton className="h-11" />
            <Skeleton className="h-64" />
          </LoadingRegion>
        ) : error && !walletData ? (
          <div role="alert" aria-live="polite" className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--warn-dim)] p-5">
            <div><p className="font-semibold text-warn">fxSAVE data is unavailable.</p><p className="mt-1 text-[12px] leading-relaxed text-mut">Your last verified savings state is not available yet. Retry the fxSAVE read before reviewing an action.</p></div>
            <Button aria-label="Retry fxSAVE state" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry fxSAVE data</Button>
          </div>
        ) : walletData ? (
          <>
            {(readWarnings.length > 0 || error) && (
              <div role="status" aria-label="Partial fxSAVE state" aria-live="polite" className="rounded-xl border border-[var(--line)] bg-[var(--warn-dim)] px-3 py-2 text-[12px] text-warn">Some fxSAVE data could not be refreshed. Verified values remain visible; retry before signing.</div>
            )}
            <SavingsSummary data={walletData} loading={loading} onRefresh={() => load(true)} fxSaveApy={fxSaveApy} fxSaveApyStatus={fxSaveApyStatus} />

            <div className="rounded-2xl bg-[var(--surface-2,var(--input))] p-1">
              <Segmented
                value={mode}
                onChange={changeMode}
                ariaLabel="fxSAVE action"
                options={[
                  { value: 'deposit', label: 'Deposit' },
                  { value: 'withdraw', label: 'Withdraw' },
                  { value: 'claim', label: 'Claim' },
                ]}
              />
            </div>

            <Card data-flow-stage={reviewStage} className={`${styles.focusCard} ${reviewStage === 'input' ? '' : styles.reviewInlineCard} p-5`}>
              {reviewStage === 'input' && <>
              {mode === 'deposit' && (
                <div className="flex flex-col gap-4">
                  <FormHeader title="Deposit" body="Choose an asset and amount." />
                  <TokenPicker label="Asset" value={token} onChange={changeToken} balances={saveBalances} balanceStatus={wallet.address ? saveBalanceStatus : 'disconnected'} />
                  <AmountField
                    label="Deposit amount"
                    symbol={labelToken(token)}
                    value={amount}
                    onChange={setAmount}
                    maxDecimals={token === 'usdc' ? 6 : 18}
                    balanceState={saveBalanceState}
                  />
                  {token !== 'fxUSDBasePool' && (
                    <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />
                  )}
                </div>
              )}

              {mode === 'withdraw' && (
                <div className="flex flex-col gap-4">
                  <FormHeader title="Withdraw" body="Choose what to receive and how to redeem." />
                  <TokenPicker label="Receive" value={token} onChange={changeToken} balances={saveBalances} balanceStatus={wallet.address ? saveBalanceStatus : 'disconnected'} />
                  <AmountField
                    label="fxSAVE to withdraw"
                    symbol="fxSAVE"
                    value={shares}
                    onChange={setShares}
                    balance={walletData.balance ? formatAmount(walletData.balance.balanceWei) : undefined}
                    allowAll
                    maxDecimals={18}
                  />
                  {token !== 'fxUSDBasePool' && (
                    <div className={styles.optionalWithdrawSettings}>
                      <ToggleRow
                      checked={instant}
                      onChange={setInstant}
                      title="Withdraw instantly"
                      body={instant
                        ? config
                          ? `${formatRatio(config.instantRedeemFeeRatio)} fee · receive without a cooldown`
                          : 'Receive without a cooldown; the withdrawal fee is shown in review.'
                        : config
                          ? `No instant fee · claim after ${formatCooldown(config.cooldownPeriodSeconds)}`
                          : 'No instant fee; claim after the cooldown.'}
                      />
                    </div>
                  )}
                  {token !== 'fxUSDBasePool' && instant && (
                    <div className={styles.optionalWithdrawSettings}>
                      <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />
                    </div>
                  )}
                  {token === 'fxUSDBasePool' && (
                    <InfoNote>fxUSD withdrawals use a queue and are not instant.</InfoNote>
                  )}
                </div>
              )}

              {mode === 'claim' && <ClaimState data={walletData} />}
              </>}

            <ActionReview
              key={reviewRevision}
              planBuilder={planBuilder}
              disabled={mode === 'claim' && !claimAvailability(walletData.claimable).canReview}
              label={mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review withdrawal' : 'Review deposit'}
              operationLabel={mode === 'claim' ? 'Claim fxSAVE redemption' : mode === 'withdraw' ? 'Withdraw fxSAVE' : 'Deposit into fxSAVE'}
              draftActionKey={mode === 'claim' ? 'earn:claim' : mode === 'withdraw' ? 'earn:withdraw' : 'earn:deposit'}
              draftResumePath="/earn"
              draftState={draftState}
              onStageChange={setReviewStage}
              onComplete={async () => {
                await Promise.all([load(true), balanceSnapshot.refresh()]);
              }}
            />
            </Card>

            {config && <VaultDetails config={config} />}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

type SaveConfig = Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveConfig']>>;
type SaveData = {
  walletAddress: string;
  balance: Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveBalance']>> | null;
  redeemStatus: Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveRedeemStatus']>> | null;
  claimable: Awaited<ReturnType<ReturnType<typeof getFxReadFacade>['getFxSaveClaimable']>> | null;
};

function SavingsSummary({ data, loading, onRefresh, fxSaveApy, fxSaveApyStatus }: { data: SaveData; loading: boolean; onRefresh: () => Promise<void>; fxSaveApy: FxSaveApyResponse | null; fxSaveApyStatus: 'loading' | 'ready' | 'unavailable' }) {
  const { prices } = useUsdPrices();
  const assetsWei = data.balance
    ? normalizedFxSaveAssetsWei(data.balance.balanceWei, data.balance.assetsWei)
    : undefined;
  const hasAssets = assetsWei !== undefined;
  const assetsUsd = fxSaveUsdValue('assetsWei', assetsWei, prices);
  const claimState = claimAvailability(data.claimable);
  const pendingShares = data.claimable?.pendingSharesWei ?? data.redeemStatus?.pendingSharesWei ?? 0n;
  const hasPending = pendingShares > 0n && (data.claimable?.hasPendingRedeem || data.redeemStatus?.hasPendingRedeem || false);
  const ready = hasPending && claimState.status === 'ready';
  const status = claimState.status === 'unavailable' && !data.redeemStatus ? '—' : ready ? 'Ready to claim' : hasPending ? 'Pending' : data.balance && data.balance.balanceWei > 0n ? 'Active' : data.balance ? 'No balance' : '—';
  const statusTone = ready ? 'bg-[var(--success-dim)] text-success' : hasPending ? 'bg-[var(--warn-dim)] text-warn' : 'bg-[var(--mint-dim)] text-mint';

  return (
    <Card className={`${styles.summaryCard} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={styles.eyebrow}>Your fxSAVE</p>
          <h2 className="text-display mt-2 break-words text-[30px] font-semibold tabular-nums tracking-[-.03em]">
            {data.balance ? `${formatDisplayAmount(data.balance.balanceWei)} fxSAVE` : '—'}
          </h2>
          {hasAssets && (
            <p className="mt-1 text-[12px] text-mut tabular-nums">
              {assetsUsd === null
                ? '—'
                : `${formatUsd(assetsUsd)} estimated value`}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void onRefresh()}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-mut transition-colors hover:bg-[var(--mint-dim)] hover:text-mint disabled:opacity-60"
          aria-label="Refresh fxSAVE state"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Metric label="fxSAVE" value={data.balance ? formatDisplayAmount(data.balance.balanceWei) : '—'} />
        <Metric label="fxUSD" value={hasAssets ? formatDisplayAmount(assetsWei) : '—'} />
        <Metric label="fxSAVE APY" value={fxSaveApyStatus === 'ready' && fxSaveApy ? `${fxSaveApy.apy.toFixed(2)}%` : '—'} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] px-3 py-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold">Pending redemption</p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-mut tabular-nums">
            {hasPending
              ? `${formatDisplayAmount(pendingShares)} fxSAVE${ready ? ' · available now' : formatRedeemableAt(data.claimable?.redeemableAt ?? data.redeemStatus?.redeemableAt ?? null)}`
              : data.claimable || data.redeemStatus ? 'None' : '—'}
          </p>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${statusTone}`}>{status}</span>
      </div>
    </Card>
  );
}

function DisconnectedEarnForm({
  mode,
  token,
  onTokenChange,
  amount,
  onAmountChange,
  shares,
  onSharesChange,
  instant,
  onInstantChange,
  slippage,
  onSlippageChange,
  config,
}: {
  mode: EarnMode;
  token: SaveToken;
  onTokenChange: (token: SaveToken) => void;
  amount: string;
  onAmountChange: (amount: string) => void;
  shares: string;
  onSharesChange: (shares: string) => void;
  instant: boolean;
  onInstantChange: (instant: boolean) => void;
  slippage: string;
  onSlippageChange: (slippage: string) => void;
  config: SaveConfig | null;
}) {
  const disconnectedBalance = { status: 'disconnected' as const };
  return (
    <div className="flex flex-col gap-4">
      {mode === 'deposit' && (
        <div className="flex flex-col gap-4">
          <FormHeader title="Deposit" body="Choose an asset and amount." />
          <TokenPicker label="Asset" value={token} onChange={onTokenChange} balanceStatus="disconnected" />
          <AmountField label="Deposit amount" symbol={labelToken(token)} value={amount} onChange={onAmountChange} maxDecimals={token === 'usdc' ? 6 : 18} balanceState={disconnectedBalance} />
          {token !== 'fxUSDBasePool' && <SlippageField value={slippage} onChange={onSlippageChange} max={MAX_FX_SLIPPAGE_PERCENT} />}
        </div>
      )}
      {mode === 'withdraw' && (
        <div className="flex flex-col gap-4">
          <FormHeader title="Withdraw" body="Choose what to receive and how to redeem." />
          <TokenPicker label="Receive" value={token} onChange={onTokenChange} balanceStatus="disconnected" />
          <AmountField label="fxSAVE to withdraw" symbol="fxSAVE" value={shares} onChange={onSharesChange} allowAll maxDecimals={18} balanceState={disconnectedBalance} />
          {token !== 'fxUSDBasePool' && <div className={styles.optionalWithdrawSettings}><ToggleRow checked={instant} onChange={onInstantChange} title="Withdraw instantly" body={instant ? config ? `${formatRatio(config.instantRedeemFeeRatio)} fee · receive without a cooldown` : 'Receive without a cooldown; the withdrawal fee is shown in review.' : config ? `No instant fee · claim after ${formatCooldown(config.cooldownPeriodSeconds)}` : 'No instant fee; claim after the cooldown.'} /></div>}
          {token !== 'fxUSDBasePool' && instant && <div className={styles.optionalWithdrawSettings}><SlippageField value={slippage} onChange={onSlippageChange} max={MAX_FX_SLIPPAGE_PERCENT} /></div>}
          {token === 'fxUSDBasePool' && <InfoNote>Base-pool share withdrawals use a queue and are not instant.</InfoNote>}
        </div>
      )}
      {mode === 'claim' && (
        <div className="flex flex-col items-center px-2 py-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Clock3 aria-hidden="true" className="h-5 w-5" /></span>
          <h2 className="text-display mt-3 text-[19px] font-semibold">Connect to check claims</h2>
          <p className="mt-1.5 max-w-[300px] text-[12px] leading-relaxed text-mut">Your wallet’s pending redemption and claim preview appear here after connection.</p>
        </div>
      )}
    </div>
  );
}

function FxSaveApyCard({ value, status }: { value: FxSaveApyResponse | null; status: 'loading' | 'ready' | 'unavailable' }) {
  const display = status === 'ready' && value ? `${value.apy.toFixed(2)}%` : '—';
  return (
    <Card className="flex min-h-14 items-center justify-between gap-3 border-[color-mix(in_srgb,var(--mint)_24%,var(--line))] px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">fxSAVE APY</p>
        <p className="mt-0.5 text-[11px] text-mut">Current vault rate</p>
      </div>
      <span className="shrink-0 text-[17px] font-semibold tabular-nums text-mint" aria-label={`fxSAVE APY ${display}`}>{display}</span>
    </Card>
  );
}

function ClaimState({ data }: { data: SaveData }) {
  const state = claimAvailability(data.claimable);
  if (state.status === 'unavailable') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2 px-2 py-3 text-center">
        <strong className="text-[13px] text-warn">Claim status is unavailable.</strong>
        <span className="text-[11px] text-mut">Retry the fxSAVE read before attempting a claim.</span>
      </div>
    );
  }
  const ready = state.status === 'ready';
  const title = ready ? 'Ready to claim' : state.status === 'cooldown' ? 'Cooldown in progress' : 'No pending redemption';
  const body = ready ? 'Review the current claim preview, then confirm in your wallet.' : state.message;

  return (
    <div className="flex flex-col items-center px-2 py-3 text-center">
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${ready ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--mint-dim)] text-mint'}`}>
        <Clock3 aria-hidden="true" className="h-5 w-5" />
      </span>
      <h2 className="text-display mt-3 text-[19px] font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-[300px] text-[12px] leading-relaxed text-mut">{body}</p>
      {data.claimable?.previewReceive && (
        <div className="mt-4 grid w-full grid-cols-2 gap-2 text-left">
          <Metric label="fxUSD preview" value={`${formatDisplayAmount(data.claimable.previewReceive.amountYieldOutWei)} fxUSD`} />
          <Metric label="USDC preview" value={`${formatDisplayAmount(data.claimable.previewReceive.amountStableOutWei, 6)} USDC`} />
        </div>
      )}
    </div>
  );
}

function VaultDetails({ config }: { config: SaveConfig }) {
  return (
    <details className="group rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
        Vault details
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-mut transition-transform group-open:rotate-180" />
      </summary>
      <div className="divide-y divide-[var(--line)] border-t border-[var(--line)] pb-1">
        <DetailRow label="Vault holdings" value={`${formatDisplayAmount(config.totalAssetsWei)} fxUSD`} />
        <DetailRow label="fxSAVE supply" value={`${formatDisplayAmount(config.totalSupplyWei)} fxSAVE`} />
        <DetailRow label="Cooldown" value={formatCooldown(config.cooldownPeriodSeconds)} />
        <DetailRow label="Instant fee" value={formatRatio(config.instantRedeemFeeRatio)} />
        <DetailRow label="Expense ratio" value={formatRatio(config.expenseRatio)} />
        <DetailRow label="Harvester ratio" value={formatRatio(config.harvesterRatio)} />
        <DetailRow label="Threshold" value={formatDisplayAmount(config.threshold)} />
      </div>
    </details>
  );
}

function TokenPicker({ label, value, onChange, balances, balanceStatus }: { label: string; value: SaveToken; onChange: (value: SaveToken) => void; balances?: TokenBalanceMap; balanceStatus?: 'loading' | 'ready' | 'unavailable' | 'disconnected' }) {
  return <TokenSelect label={label} value={value} options={['fxUSD', 'usdc', 'fxUSDBasePool'] as const} onChange={onChange} balances={balances} balanceStatus={balanceStatus} />;
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
    <div className={`${styles.metric} min-w-0 p-2.5 sm:p-3`}>
      <span className="block text-[10px] leading-tight text-mut sm:text-[11px]">{label}</span>
      <span className="mt-1 block break-words text-[12px] font-semibold tabular-nums sm:text-[13px]" title={value}>{value}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-[12px]">
      <span className="text-mut">{label}</span>
      <span className="max-w-[62%] break-words text-right font-semibold tabular-nums" title={value}>{value}</span>
    </div>
  );
}

function formatDisplayAmount(value: bigint | undefined, decimals = 18, digits = 5): string {
  const formatted = formatAmount(value, decimals, digits);
  if (formatted === '—') return formatted;
  const [integer, fraction] = formatted.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function formatRatio(value: bigint): string {
  return `${formatDisplayAmount(value, 16)}%`;
}

function formatCooldown(seconds: bigint): string {
  if (seconds % 3600n === 0n) return `${seconds / 3600n}h`;
  if (seconds % 60n === 0n) return `${seconds / 60n}m`;
  return `${seconds}s`;
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function formatRedeemableAt(timestamp: number | null): string {
  return timestamp ? ` · claim ${formatTimestamp(timestamp)}` : ' · cooldown active';
}
