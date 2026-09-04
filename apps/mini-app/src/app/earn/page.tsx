'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Clock3, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, Segmented, SlippageField, ToggleRow, TokenSelect, useWalletTokenBalances, type TokenBalanceMap } from '@/components/ProtocolForm';
import { useUsdPrices } from '@/components/PriceProvider';
import { formatUsd } from '@/lib/prices';
import { FX_SAVE_UNITS, fxSaveUsdValue, normalizedFxSaveAssetsWei } from '@/lib/fxSaveUnits';
import {
  assertConfiguredPublicClientChain,
  getFxSdk,
  MAX_FX_SLIPPAGE_PERCENT,
  planDepositFxSave,
  planRedeem,
  planWithdrawFxSave,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import { userSafeError } from '@/lib/errors';
import { claimAvailability, cooldownRefreshDelayMs, createEarnReadGuard } from '@/lib/earnState';
import { formatAmount, parseAmount, type SaveToken } from '@/app/trade/fxUi';
import styles from '@/components/FlowWorkspace.module.css';

type EarnMode = 'deposit' | 'withdraw' | 'claim';

function labelToken(token: SaveToken): string {
  if (token === 'usdc') return 'USDC';
  if (token === 'fxUSDBasePool') return 'fxUSD pool token';
  return token;
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

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  const load = useCallback(async (force = false) => {
    const request = readGuard.current.begin(force);
    if (request === null) return;
    const address = wallet.address;
    setLoading(true);
    setError('');
    try {
      await assertConfiguredPublicClientChain(1);
      const sdk = getFxSdk();
      if (!address) {
        const result = await Promise.allSettled([sdk.getFxSaveConfig({})]);
        if (!readGuard.current.isCurrent(request)) return;
        if (result[0].status === 'fulfilled') {
          setConfig(result[0].value);
          setError('');
        } else {
          setError(userSafeError(result[0].reason, 'fxSAVE vault details are temporarily unavailable.'));
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
      const warnings = [
        nextConfig.status === 'rejected' ? (configRef.current ? 'Vault details could not be refreshed; showing the last verified values.' : 'Vault details are temporarily unavailable.') : '',
        balance.status === 'rejected' && !previous?.balance ? 'fxSAVE balance is unavailable.' : balance.status === 'rejected' ? 'fxSAVE balance refresh failed; showing the last verified value.' : '',
        redeemStatus.status === 'rejected' && !previous?.redeemStatus ? 'Redemption status is unavailable.' : redeemStatus.status === 'rejected' ? 'Redemption status refresh failed; showing the last verified value.' : '',
        claimable.status === 'rejected' && !previous?.claimable ? 'Claim availability is unavailable.' : claimable.status === 'rejected' ? 'Claim availability refresh failed; showing the last verified value.' : '',
      ].filter(Boolean);
      setReadWarnings(warnings);
      if (nextData.balance || nextData.redeemStatus || nextData.claimable) setError('');
      else setError('fxSAVE state is temporarily unavailable. Refresh to try again.');
    } catch (cause) {
      if (!readGuard.current.isCurrent(request)) return;
      setError(userSafeError(cause, 'fxSAVE state is unavailable. Check the Ethereum connection and try again.'));
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
      <div className={styles.workspace}>
        <nav className={`grid grid-cols-2 ${styles.productSwitch}`} aria-label="Savings and borrowing">
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">fxSAVE</span>
          <Link href="/borrow" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">Borrow fxUSD</Link>
        </nav>
        {!wallet.address ? (
          <>
            <WalletConnectCTA
              ready={wallet.ready}
              authenticated={wallet.authenticated}
              body="Choose or connect a wallet to view your fxSAVE balance and manage withdrawals."
            />
            {config && <VaultDetails config={config} />}
          </>
        ) : loading && !walletData ? (
          <LoadingRegion label="Reading fxSAVE state" className="flex flex-col gap-3.5">
            <Skeleton className="h-44" />
            <Skeleton className="h-11" />
            <Skeleton className="h-64" />
          </LoadingRegion>
        ) : error && !walletData ? (
          <EmptyState
            icon={RefreshCw}
            title="fxSAVE state unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : walletData ? (
          <>
            {(readWarnings.length > 0 || error) && (
              <div role="status" aria-live="polite" className="rounded-xl border border-[var(--line)] bg-[var(--warn-dim)] px-3 py-2 text-[11px] leading-relaxed text-warn">
                {readWarnings.length > 0 ? readWarnings.join(' ') : error}
              </div>
            )}
            <SavingsSummary data={walletData} loading={loading} onRefresh={() => load(true)} stale={readWarnings.length > 0 || Boolean(error)} />

            <div className="rounded-2xl bg-[var(--surface-2,var(--input))] p-1">
              <Segmented
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setToken('fxUSD');
                  setAmount('');
                  setShares('');
                }}
                ariaLabel="fxSAVE action"
                options={[
                  { value: 'deposit', label: 'Deposit' },
                  { value: 'withdraw', label: 'Withdraw' },
                  { value: 'claim', label: 'Claim' },
                ]}
              />
            </div>

            <Card className={`${styles.focusCard} p-5`}>
              {mode === 'deposit' && (
                <div className="flex flex-col gap-4">
                  <FormHeader title="Deposit" body="Choose an asset and amount." />
                  <TokenPicker label="Asset" value={token} onChange={setToken} balances={saveBalances} balanceStatus={wallet.address ? saveBalanceStatus : 'disconnected'} />
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
                  <TokenPicker label="Receive" value={token} onChange={setToken} balances={saveBalances} balanceStatus={wallet.address ? saveBalanceStatus : 'disconnected'} />
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
                  )}
                  {token !== 'fxUSDBasePool' && instant && (
                    <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />
                  )}
                  {token === 'fxUSDBasePool' && (
                    <InfoNote>The fxUSD pool token uses a queued withdrawal, so it is not instant.</InfoNote>
                  )}
                </div>
              )}

              {mode === 'claim' && <ClaimState data={walletData} />}
            </Card>

            <ActionReview
              planBuilder={planBuilder}
              disabled={mode === 'claim' && !claimAvailability(walletData.claimable).canReview}
              label={mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review withdrawal' : 'Review deposit'}
              operationLabel={mode === 'claim' ? 'Claim fxSAVE redemption' : mode === 'withdraw' ? 'Withdraw fxSAVE' : 'Deposit into fxSAVE'}
              onComplete={async () => {
                await Promise.all([load(true), balanceSnapshot.refresh()]);
              }}
            />

            {config && <VaultDetails config={config} />}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

type SaveConfig = Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveConfig']>>;
type SaveData = {
  walletAddress: string;
  balance: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveBalance']>> | null;
  redeemStatus: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveRedeemStatus']>> | null;
  claimable: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveClaimable']>> | null;
};

function SavingsSummary({ data, loading, onRefresh, stale }: { data: SaveData; loading: boolean; onRefresh: () => Promise<void>; stale: boolean }) {
  const { prices, status: priceStatus, refreshing: pricesRefreshing } = useUsdPrices();
  const assetsWei = data.balance
    ? normalizedFxSaveAssetsWei(data.balance.balanceWei, data.balance.assetsWei)
    : undefined;
  const hasAssets = assetsWei !== undefined;
  const assetsUsd = fxSaveUsdValue('assetsWei', assetsWei, prices);
  const claimState = claimAvailability(data.claimable);
  const pendingShares = data.claimable?.pendingSharesWei ?? data.redeemStatus?.pendingSharesWei ?? 0n;
  const hasPending = pendingShares > 0n && (data.claimable?.hasPendingRedeem || data.redeemStatus?.hasPendingRedeem || false);
  const ready = hasPending && claimState.status === 'ready';
  const status = claimState.status === 'unavailable' && !data.redeemStatus ? 'Unavailable' : ready ? 'Ready to claim' : hasPending ? 'Pending' : data.balance && data.balance.balanceWei > 0n ? 'Active' : data.balance ? 'No balance' : 'Unavailable';
  const statusTone = ready ? 'bg-[var(--success-dim)] text-success' : hasPending ? 'bg-[var(--warn-dim)] text-warn' : 'bg-[var(--mint-dim)] text-mint';

  return (
    <Card className={`${styles.summaryCard} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={styles.eyebrow}>Your fxSAVE</p>
            {stale && <span className="rounded-full bg-[var(--warn-dim)] px-2 py-0.5 text-[10px] font-semibold text-warn">Last verified</span>}
          </div>
          <h2 className="text-display mt-2 break-words text-[30px] font-semibold tabular-nums tracking-[-.03em]">
            {data.balance ? `${formatDisplayAmount(data.balance.balanceWei)} fxSAVE` : '—'}
          </h2>
          {hasAssets && (
            <p className="mt-1 text-[12px] text-mut tabular-nums">
              {assetsUsd === null
                ? priceStatus === 'loading' || pricesRefreshing ? 'Value loading…' : 'Price delayed · retrying'
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

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Metric label={FX_SAVE_UNITS.balanceWei.label} value={data.balance ? formatDisplayAmount(data.balance.balanceWei) : 'Unavailable'} />
        <Metric label={FX_SAVE_UNITS.assetsWei.label} value={hasAssets ? formatDisplayAmount(assetsWei) : 'Unavailable'} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] px-3 py-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold">Pending redemption</p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-mut tabular-nums">
            {hasPending
              ? `${formatDisplayAmount(pendingShares)} ${FX_SAVE_UNITS.pendingSharesWei.label}${ready ? ' · available now' : formatRedeemableAt(data.claimable?.redeemableAt ?? data.redeemStatus?.redeemableAt ?? null)}`
              : data.claimable || data.redeemStatus ? 'None' : 'Unavailable'}
          </p>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${statusTone}`}>{status}</span>
      </div>
    </Card>
  );
}

function ClaimState({ data }: { data: SaveData }) {
  const state = claimAvailability(data.claimable);
  const ready = state.status === 'ready';
  const title = ready ? 'Ready to claim' : state.status === 'cooldown' ? 'Cooldown in progress' : state.status === 'empty' ? 'No pending redemption' : 'Claim unavailable';
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
        <DetailRow label="Vault holdings" value={`${formatDisplayAmount(config.totalAssetsWei)} ${FX_SAVE_UNITS.totalAssetsWei.label}`} />
        <DetailRow label="fxSAVE supply" value={`${formatDisplayAmount(config.totalSupplyWei)} ${FX_SAVE_UNITS.totalSupplyWei.label}`} />
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
    <div>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={`mt-1 ${styles.supportCopy}`}>{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${styles.metric} p-3`}>
      <span className="block text-[11px] text-mut">{label}</span>
      <span className="mt-1 block break-words text-[13px] font-semibold tabular-nums" title={value}>{value}</span>
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
