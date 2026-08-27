'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Clock3, RefreshCw, Sparkles } from 'lucide-react';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, Segmented, SlippageField, ToggleRow } from '@/components/ProtocolForm';
import { assertConfiguredPublicClientChain, getFxSdk, MAX_FX_SLIPPAGE_PERCENT, planDepositFxSave, planRedeem, planWithdrawFxSave } from '@/lib/fx';
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
    setLoading(true);
    setError('');
    try {
      await assertConfiguredPublicClientChain(1);
      const sdk = getFxSdk();
      if (!wallet.address) {
        setConfig(await sdk.getFxSaveConfig({}));
        setData(null);
        return;
      }
      const [nextConfig, balance, redeemStatus, claimable] = await Promise.all([
        sdk.getFxSaveConfig({}),
        sdk.getFxSaveBalance({ userAddress: wallet.address }),
        sdk.getFxSaveRedeemStatus({ userAddress: wallet.address }),
        sdk.getFxSaveClaimable({ userAddress: wallet.address }),
      ]);
      setConfig(nextConfig);
      setData({ balance, redeemStatus, claimable });
    } catch (cause) {
      setError(userSafeError(cause, 'fxSAVE state is unavailable. Check the Ethereum connection and try again.'));
    } finally { setLoading(false); }
  }, [wallet.address]);

  useEffect(() => { void load(); }, [load]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (mode === 'claim') {
      if (!data?.claimable.isCooldownComplete) return null;
      return () => planRedeem({ userAddress: wallet.address! });
    }
    if (mode === 'deposit') {
      const amountWei = parseAmount(amount, token === 'usdc' ? 'USDC' : token === 'fxUSDBasePool' ? 'fxUSDBasePool' : 'fxUSD');
      if (!amountWei) return null;
      const slippageValue = Number(slippage);
      if ((token !== 'fxUSDBasePool' && (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT))) return null;
      return () => planDepositFxSave({ userAddress: wallet.address!, tokenIn: token, amount: amountWei, slippage: token === 'fxUSDBasePool' ? undefined : slippageValue });
    }
    const sharesWei = shares.toLowerCase() === 'all'
      ? data?.balance.balanceWei ?? null
      : parseAmount(shares, 'fxSAVE');
    if (!sharesWei) return null;
    const slippageValue = Number(slippage);
    if (instant && token !== 'fxUSDBasePool' && (!Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT)) return null;
    return () => planWithdrawFxSave({ userAddress: wallet.address!, tokenOut: token, amount: sharesWei, instant: token === 'fxUSDBasePool' ? false : instant, slippage: instant && token !== 'fxUSDBasePool' ? slippageValue : undefined });
  }, [amount, data?.balance.balanceWei, data?.claimable.isCooldownComplete, instant, mode, shares, slippage, token, wallet.address]);

  return (
    <AppShell title="Earn" subtitle="Read fxSAVE configuration and balances, then deposit, withdraw, or claim only when the protocol says it is available.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">fxSAVE</p><h2 className="text-display mt-2 text-[26px] font-semibold">Protocol savings state</h2><p className="mt-1 text-[11px] leading-relaxed text-mut">Configuration, shares, cooldown, and claim preview are read directly through the official SDK.</p></div><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Sparkles className="h-5 w-5" /></span></div><div className="mt-5 grid grid-cols-2 gap-2"><Metric label="Protocol shares" value={config ? formatAmount(config.totalSupplyWei) : '—'} /><Metric label="Protocol assets" value={config ? formatAmount(config.totalAssetsWei) : '—'} /><Metric label="Cooldown" value={config ? `${Number(config.cooldownPeriodSeconds) / 3600}h` : '—'} /><Metric label="Instant fee" value={config ? formatRatio(config.instantRedeemFeeRatio) : '—'} /><Metric label="Expense ratio" value={config ? formatRatio(config.expenseRatio) : '—'} /><Metric label="Harvester ratio" value={config ? formatRatio(config.harvesterRatio) : '—'} /><Metric label="Threshold" value={config ? formatAmount(config.threshold) : '—'} /><Metric label="Your shares" value={data ? formatAmount(data.balance.balanceWei) : 'Connect wallet'} /><Metric label="Your assets" value={data?.balance.assetsWei === undefined ? '—' : formatAmount(data.balance.assetsWei)} /><Metric label="Pending redeem" value={data?.redeemStatus.hasPendingRedeem ? formatAmount(data.redeemStatus.pendingSharesWei) : data ? 'None' : '—'} /></div></Card>
        {!wallet.address ? <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to read fxSAVE balances and authorize deposits, withdrawals, or claims." /> : loading && !data ? <LoadingRegion label="Reading fxSAVE state" className="flex flex-col gap-3.5"><Skeleton className="h-24" /><Skeleton className="h-64" /></LoadingRegion> : error ? <EmptyState icon={RefreshCw} title="fxSAVE state unavailable" body={error} action={<Button onClick={() => void load()}>Retry</Button>} /> : <>
          <Segmented value={mode} onChange={(next) => { setMode(next); setToken('fxUSD'); setAmount(''); setShares(''); }} ariaLabel="fxSAVE action" options={[{ value: 'deposit', label: 'Deposit' }, { value: 'withdraw', label: 'Withdraw' }, { value: 'claim', label: 'Claim' }]} />
          <Card className="p-4">{mode === 'deposit' && <div className="flex flex-col gap-4"><Header icon={ArrowDownToLine} title="Deposit into fxSAVE" body="Choose one of the three official SDK input tokens." /><TokenPicker value={token} onChange={setToken} /><AmountField label="Deposit amount" symbol={labelToken(token)} value={amount} onChange={setAmount} maxDecimals={token === 'usdc' ? 6 : 18} />{token !== 'fxUSDBasePool' && <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />}<InfoNote>fxUSDBasePool deposits use the direct vault path. USDC and fxUSD use the SDK’s slippage-aware route.</InfoNote></div>}{mode === 'withdraw' && <div className="flex flex-col gap-4"><Header icon={ArrowUpFromLine} title="Withdraw fxSAVE shares" body="The SDK supports direct, queued, or instant redemption paths." /><TokenPicker value={token} onChange={setToken} /><AmountField label="Shares to withdraw" symbol="fxSAVE" value={shares} onChange={setShares} balance={data ? formatAmount(data.balance.balanceWei) : undefined} allowAll maxDecimals={18} />{token !== 'fxUSDBasePool' && <ToggleRow checked={instant} onChange={setInstant} title="Instant redemption" body={instant ? 'The SDK applies its instant fee and slippage path.' : 'Queued redemption uses cooldown before claim.'} />}{token !== 'fxUSDBasePool' && instant && <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />}{token === 'fxUSDBasePool' && <InfoNote>Base-pool withdrawal is a direct, non-instant SDK path.</InfoNote>}</div>}{mode === 'claim' && <div className="flex flex-col items-center px-2 py-4 text-center"><span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${data?.claimable.isCooldownComplete ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--mint-dim)] text-mint'}`}><Clock3 className="h-6 w-6" /></span><h2 className="text-display mt-4 text-[20px] font-semibold">{data?.claimable.isCooldownComplete ? 'Claimable now' : data?.claimable.hasPendingRedeem ? 'Cooldown in progress' : 'No pending redemption'}</h2><p className="mt-1.5 max-w-[300px] text-[11.5px] leading-relaxed text-mut">{data?.claimable.isCooldownComplete ? 'The SDK reports a completed cooldown. Review the exact claim transaction.' : data?.claimable.hasPendingRedeem ? 'Wait until the on-chain cooldown completes. FxAeon does not guess claim timing.' : 'Queue a withdrawal first.'}</p>{data?.claimable.previewReceive && <div className="mt-4 grid w-full grid-cols-2 gap-2"><Metric label="fxUSD preview" value={formatAmount(data.claimable.previewReceive.amountYieldOutWei)} /><Metric label="USDC preview" value={formatAmount(data.claimable.previewReceive.amountStableOutWei, 6)} /></div>}</div>}</Card>
          <ActionReview planBuilder={planBuilder} disabled={mode === 'claim' && !data?.claimable.isCooldownComplete} label={mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review withdrawal' : 'Review deposit'} operationLabel={mode === 'claim' ? 'Claim fxSAVE redemption' : mode === 'withdraw' ? 'Withdraw fxSAVE shares' : 'Deposit into fxSAVE'} onComplete={load} />
        </>}
      </div>
    </AppShell>
  );
}

type SaveConfig = Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveConfig']>>;
type SaveData = { balance: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveBalance']>>; redeemStatus: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveRedeemStatus']>>; claimable: Awaited<ReturnType<ReturnType<typeof getFxSdk>['getFxSaveClaimable']>> };
function formatRatio(value: bigint): string { return `${formatAmount(value, 16)}%`; }
function TokenPicker({ value, onChange }: { value: SaveToken; onChange: (value: SaveToken) => void }) { return <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="fxSAVE token"><>{(['fxUSD', 'usdc', 'fxUSDBasePool'] as const).map((item) => <button key={item} type="button" role="radio" aria-checked={value === item} onClick={() => onChange(item)} className={`min-h-12 rounded-xl border px-2 text-[11px] font-semibold ${value === item ? 'border-[rgba(139,109,255,.55)] bg-[var(--mint-dim)] text-[var(--text)]' : 'border-[var(--line)] text-mut'}`}>{labelToken(item)}</button>)}</></div>; }
function Header({ icon: Icon, title, body }: { icon: typeof ArrowDownToLine; title: string; body: string }) { return <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-5 w-5" /></span><div><h2 className="text-[14px] font-semibold">{title}</h2><p className="mt-0.5 text-[10.5px] text-mut">{body}</p></div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[rgba(255,255,255,.035)] p-3"><span className="block text-[9px] uppercase tracking-[0.1em] text-mut">{label}</span><span className="mt-1 block truncate text-[12px] font-semibold">{value}</span></div>; }
