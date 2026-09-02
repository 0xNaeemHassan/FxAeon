'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock3, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, Segmented, SlippageField, ToggleRow, TokenSelect } from '@/components/ProtocolForm';
import { useUsdPrice } from '@/components/PriceProvider';
import { formatUsd, usdValueForUnits } from '@/lib/prices';
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
import { formatAmount, parseAmount, type SaveToken } from '@/app/trade/fxUi';

type EarnMode = 'deposit' | 'withdraw' | 'claim';

function labelToken(token: SaveToken): string {
  if (token === 'usdc') return 'USDC';
  if (token === 'fxUSDBasePool') return 'fxUSD base pool';
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

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  const load = useCallback(async () => {
    const address = wallet.address;
    setLoading(true);
    setError('');
    try {
      await assertConfiguredPublicClientChain(1);
      const sdk = getFxSdk();
      if (!address) {
        setConfig(await sdk.getFxSaveConfig({}));
        setData(null);
        return;
      }
      const [nextConfig, balance, redeemStatus, claimable] = await Promise.all([
        sdk.getFxSaveConfig({}),
        sdk.getFxSaveBalance({ userAddress: address }),
        sdk.getFxSaveRedeemStatus({ userAddress: address }),
        sdk.getFxSaveClaimable({ userAddress: address }),
      ]);
      setConfig(nextConfig);
      setData({ walletAddress: address, balance, redeemStatus, claimable });
    } catch (cause) {
      setError(userSafeError(cause, 'fxSAVE state is unavailable. Check the Ethereum connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => { void load(); }, [load]);

  const walletData = data?.walletAddress === wallet.address ? data : null;

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (mode === 'claim') {
      if (!walletData?.claimable.isCooldownComplete) return null;
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
      ? walletData?.balance.balanceWei ?? null
      : parseAmount(shares, 'fxSAVE');
    if (!sharesWei) return null;
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
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[var(--input)] p-1" aria-label="Earn products">
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">fxSAVE</span>
          <Link href="/borrow" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">Borrow / fxMINT</Link>
        </div>
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
        ) : error ? (
          <EmptyState
            icon={RefreshCw}
            title="fxSAVE state unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : walletData ? (
          <>
            <SavingsSummary data={walletData} loading={loading} onRefresh={load} />

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

            <Card className="p-4">
              {mode === 'deposit' && (
                <div className="flex flex-col gap-4">
                  <FormHeader title="Deposit" body="Choose an asset and amount." />
                  <TokenPicker label="Asset" value={token} onChange={setToken} />
                  <AmountField
                    label="Deposit amount"
                    symbol={labelToken(token)}
                    value={amount}
                    onChange={setAmount}
                    maxDecimals={token === 'usdc' ? 6 : 18}
                  />
                  {token !== 'fxUSDBasePool' && (
                    <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />
                  )}
                </div>
              )}

              {mode === 'withdraw' && (
                <div className="flex flex-col gap-4">
                  <FormHeader title="Withdraw" body="Choose what to receive and how to redeem." />
                  <TokenPicker label="Receive" value={token} onChange={setToken} />
                  <AmountField
                    label="Shares to withdraw"
                    symbol="fxSAVE"
                    value={shares}
                    onChange={setShares}
                    balance={formatAmount(walletData.balance.balanceWei)}
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
                    <InfoNote>Base-pool withdrawals are direct and do not use the instant route.</InfoNote>
                  )}
                </div>
              )}

              {mode === 'claim' && <ClaimState data={walletData} />}
            </Card>

            <ActionReview
              planBuilder={planBuilder}
              disabled={mode === 'claim' && !walletData.claimable.isCooldownComplete}
              label={mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review withdrawal' : 'Review deposit'}
              operationLabel={mode === 'claim' ? 'Claim fxSAVE redemption' : mode === 'withdraw' ? 'Withdraw fxSAVE shares' : 'Deposit into fxSAVE'}
              onComplete={load}
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
  balance: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveBalance']>>;
  redeemStatus: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveRedeemStatus']>>;
  claimable: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveClaimable']>>;
};

function SavingsSummary({ data, loading, onRefresh }: { data: SaveData; loading: boolean; onRefresh: () => Promise<void> }) {
  const fxUsdPrice = useUsdPrice('fxUSD');
  const hasAssets = data.balance.assetsWei !== undefined;
  const hasPending = data.redeemStatus.hasPendingRedeem || data.claimable.hasPendingRedeem;
  const ready = hasPending && data.claimable.isCooldownComplete;
  const status = ready ? 'Ready to claim' : hasPending ? 'Pending' : data.balance.balanceWei > 0n ? 'Active' : 'No balance';
  const statusTone = ready ? 'bg-[var(--success-dim)] text-success' : hasPending ? 'bg-[var(--warn-dim)] text-warn' : 'bg-[var(--mint-dim)] text-mint';

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-mut">Your fxSAVE</p>
          <h2 className="text-display mt-1 break-words text-[26px] font-semibold tabular-nums">
            {hasAssets
              ? `${formatDisplayAmount(data.balance.assetsWei)} fxUSD`
              : `${formatDisplayAmount(data.balance.balanceWei)} fxSAVE`}
          </h2>
          {hasAssets && (
            <p className="mt-1 text-[12px] text-mut tabular-nums">
              {formatUsd(usdValueForUnits(data.balance.assetsWei ?? 0n, 18, fxUsdPrice))} · {formatDisplayAmount(data.balance.balanceWei)} fxSAVE shares
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

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Shares" value={`${formatDisplayAmount(data.balance.balanceWei)} fxSAVE`} />
        <Metric label="Assets" value={hasAssets ? `${formatDisplayAmount(data.balance.assetsWei)} fxUSD` : 'Unavailable'} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold">Pending redemption</p>
          <p className="mt-0.5 truncate text-[11px] text-mut tabular-nums">
            {hasPending
              ? `${formatDisplayAmount(data.redeemStatus.pendingSharesWei)} fxSAVE${ready ? ' · available now' : formatRedeemableAt(data.claimable.redeemableAt)}`
              : 'None'}
          </p>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${statusTone}`}>{status}</span>
      </div>
    </Card>
  );
}

function ClaimState({ data }: { data: SaveData }) {
  const hasPending = data.claimable.hasPendingRedeem || data.redeemStatus.hasPendingRedeem;
  const ready = hasPending && data.claimable.isCooldownComplete;
  const title = ready ? 'Ready to claim' : hasPending ? 'Cooldown in progress' : 'No pending redemption';
  const body = ready
    ? 'Review the current claim preview, then confirm in your wallet.'
    : hasPending
      ? data.claimable.redeemableAt
        ? `Claim after ${formatTimestamp(data.claimable.redeemableAt)}.`
        : 'Claim becomes available after the cooldown completes.'
      : 'Choose a queued withdrawal to start a redemption.';

  return (
    <div className="flex flex-col items-center px-2 py-3 text-center">
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${ready ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--mint-dim)] text-mint'}`}>
        <Clock3 aria-hidden="true" className="h-5 w-5" />
      </span>
      <h2 className="text-display mt-3 text-[19px] font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-[300px] text-[12px] leading-relaxed text-mut">{body}</p>
      {data.claimable.previewReceive && (
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
    <details className="group rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
        Vault details
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-mut transition-transform group-open:rotate-180" />
      </summary>
      <div className="divide-y divide-[var(--line)] border-t border-[var(--line)] pb-1">
        <DetailRow label="Total assets" value={`${formatDisplayAmount(config.totalAssetsWei)} fxUSD`} />
        <DetailRow label="Total shares" value={`${formatDisplayAmount(config.totalSupplyWei)} fxSAVE`} />
        <DetailRow label="Cooldown" value={formatCooldown(config.cooldownPeriodSeconds)} />
        <DetailRow label="Instant fee" value={formatRatio(config.instantRedeemFeeRatio)} />
        <DetailRow label="Expense ratio" value={formatRatio(config.expenseRatio)} />
        <DetailRow label="Harvester ratio" value={formatRatio(config.harvesterRatio)} />
        <DetailRow label="Threshold" value={formatDisplayAmount(config.threshold)} />
      </div>
    </details>
  );
}

function TokenPicker({ label, value, onChange }: { label: string; value: SaveToken; onChange: (value: SaveToken) => void }) {
  return <TokenSelect label={label} value={value} options={['fxUSD', 'usdc', 'fxUSDBasePool'] as const} onChange={onChange} />;
}

function FormHeader({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-[12px] text-mut">{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[rgba(255,255,255,.035)] p-3">
      <span className="block text-[11px] text-mut">{label}</span>
      <span className="mt-1 block truncate text-[13px] font-semibold tabular-nums" title={value}>{value}</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5 text-[12px]">
      <span className="text-mut">{label}</span>
      <span className="max-w-[62%] truncate text-right font-semibold tabular-nums" title={value}>{value}</span>
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
