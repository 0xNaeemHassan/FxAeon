'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gauge, Layers2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, LeverageField, RangeField, Segmented, SlippageField, TokenSelect } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planAdjustPositionLeverage, planIncreasePosition, planReducePosition, readLeverageBounds, type LeverageBounds } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import { userSafeError } from '@/lib/errors';
import {
  formatAmount,
  getSdkReductionAmountWei,
  parseAmount,
  positionCollateralDecimals,
  positionDebtDecimals,
  positionKey,
  positionInputTokenOptions,
  positionOutputTokenOptions,
  readAllPositions,
  tokenAddress,
  tokenDecimals,
  type UiPosition,
  type UiToken,
} from '@/app/trade/fxUi';

type PositionAction = 'increase' | 'reduce' | 'leverage';

export default function PositionsPage() {
  const wallet = usePrivyWallet();
  const [positions, setPositions] = useState<UiPosition[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [action, setAction] = useState<PositionAction>('increase');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [fraction, setFraction] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!wallet.address) {
      setPositions([]);
      setSelectedKey('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await readAllPositions(wallet.address);
      setPositions(next);
      setSelectedKey((current) => current && next.some((position) => positionKey(position) === current) ? current : next[0] ? positionKey(next[0]) : '');
    } catch (cause) {
      setError(userSafeError(cause, 'Position state is unavailable. Check the Ethereum connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);

  useEffect(() => { void load(); }, [load]);

  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const marketTokens = selected
    ? action === 'reduce'
      ? positionOutputTokenOptions(selected.market, selected.side)
      : positionInputTokenOptions(selected.market)
    : positionInputTokenOptions('ETH');
  const validAmount = positiveDecimal(amount, action === 'reduce' && selected ? positionCollateralDecimals(selected) : tokenDecimals(token));

  useEffect(() => {
    if (!selected) return;
    setToken((current) => marketTokens.includes(current) ? current : marketTokens[0]);
    const sdkLeverage = selected.side === 'short' ? selected.info.lsdLeverage : selected.info.currentLeverage;
    setLeverage(clampLeverage(Math.max(0.1, sdkLeverage), leverageBounds));
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

  const leverageError = leverage > 0 && leverage < leverageBounds.min
    ? `Minimum pool leverage is ${leverageBounds.min.toFixed(1)}×.`
    : null;

  const planBuilder = useMemo(() => {
    if (!selected || !wallet.address) return null;
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
      if (!amountWei) return null;
      // The SDK's short-pool increase path expects the LSD leverage field,
      // while long pools use the regular leverage field. Both are exposed as
      // an editable target so an existing position can actually exercise the
      // complete official increasePosition input surface.
      return () => planIncreasePosition({ ...common, leverage, inputTokenAddress: tokenAddress(token), amount: amountWei });
    }
    if (action === 'reduce') {
      return async () => {
        const reduction = await getSdkReductionAmountWei({
          market: selected.market,
          side: selected.side,
          rawCollateralWei: selected.info.rawColls,
          rawDebtWei: selected.info.rawDebts,
          fractionBps: fraction * 100,
        });
        return planReducePosition({ ...common, amount: reduction, outputTokenAddress: tokenAddress(token), isClosePosition: fraction === 100 });
      };
    }
    if (!Number.isFinite(leverage) || leverage <= 0) return null;
    return () => planAdjustPositionLeverage({ ...common, leverage });
  }, [action, fraction, leverage, selected, slippage, token, validAmount, wallet.address]);

  return (
    <AppShell title="Positions">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,.18)] p-1" aria-label="Trade views">
          <Link href="/trade" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">New position</Link>
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">Positions</span>
        </div>
        {!wallet.address ? (
          <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to see and manage your open positions." />
        ) : loading && !positions.length ? (
          <LoadingRegion label="Reading positions" className="flex flex-col gap-3.5"><Skeleton className="h-24" /><Skeleton className="h-48" /></LoadingRegion>
        ) : error ? (
          <EmptyState icon={RefreshCw} title="Position read unavailable" body={error} action={<Button onClick={() => void load()}>Retry</Button>} />
        ) : !positions.length ? (
          <EmptyState icon={Layers2} title="No open positions" body="Open an ETH or BTC position to get started." action={<Link href="/trade" className="button button-primary flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold">Open a position</Link>} />
        ) : (
          <>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Open positions">
              {positions.map((position) => {
                const active = positionKey(position) === selectedKey;
                const leverageValue = position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage;
                return (
                  <button key={positionKey(position)} type="button" role="radio" aria-checked={active} onClick={() => setSelectedKey(positionKey(position))} className={`glass-press flex min-h-[72px] w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left ${active ? 'border-mint bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><span className="text-[15px] font-semibold">{position.market} {position.side === 'long' ? 'Long' : 'Short'}</span><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${position.side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{position.side}</span></span>
                      <span className="mt-1 block truncate text-[11px] text-mut">{formatAmount(position.info.rawColls, positionCollateralDecimals(position))} {position.info.rawCollsToken} collateral · #{position.info.positionId}</span>
                    </span>
                    <span className="ml-3 shrink-0 text-[17px] font-semibold tabular-nums">{leverageValue.toFixed(2)}×</span>
                  </button>
                );
              })}
            </div>

            {selected && <Card className="p-4"><div className="flex items-start justify-between gap-3"><div><span className="text-[12px] text-mut">Selected</span><h2 className="mt-0.5 text-[18px] font-semibold">{selected.market} {selected.side === 'long' ? 'Long' : 'Short'}</h2><p className="mt-0.5 text-[11px] text-mut">Position #{selected.info.positionId}</p></div><button type="button" onClick={() => void load()} className="flex h-11 w-11 items-center justify-center rounded-xl text-mut hover:bg-[var(--mint-dim)] hover:text-mint" aria-label="Refresh positions"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div><div className="mt-4 grid grid-cols-2 gap-2"><Metric label="Collateral" value={`${formatAmount(selected.info.rawColls, positionCollateralDecimals(selected))} ${selected.info.rawCollsToken}`} /><Metric label="Debt" value={`${formatAmount(selected.info.rawDebts, positionDebtDecimals(selected))} ${selected.info.rawDebtsToken}`} /><Metric label="Leverage" value={`${(selected.side === 'short' ? selected.info.lsdLeverage : selected.info.currentLeverage).toFixed(2)}×`} /></div>{selected.side === 'long' && <Link href="/borrow" className="glass-press mt-3 flex min-h-11 items-center justify-between rounded-xl border border-[var(--line)] px-3 text-[12px] font-semibold text-mint">Manage debt <span aria-hidden="true">→</span></Link>}</Card>}

            <Segmented value={action} onChange={setAction} ariaLabel="Position action" options={[{ value: 'increase', label: 'Increase' }, { value: 'reduce', label: 'Reduce' }, { value: 'leverage', label: 'Leverage' }]} />
            <Card className="p-4">
              {action === 'increase' && <div className="flex flex-col gap-4"><Header icon={ArrowUpRight} title="Increase exposure" body="Add collateral and choose the target leverage for this position." /><TokenSelect label="Input asset" value={token} options={marketTokens} onChange={setToken} /><AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
              {action === 'reduce' && <div className="flex flex-col gap-4"><Header icon={ArrowDownRight} title={fraction === 100 ? 'Close position' : 'Reduce exposure'} body="Choose how much of this position to reduce and what asset to receive." /><RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={100} step={1} suffix="%" /><div className="grid grid-cols-4 gap-2">{[25, 50, 75, 100].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`min-h-11 rounded-xl text-[11px] font-semibold ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.035)] text-mut'}`}>{value === 100 ? 'Close' : `${value}%`}</button>)}</div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={setToken} /></div>}
              {action === 'leverage' && <div className="flex flex-col gap-4"><Header icon={Gauge} title="Adjust leverage" body="Set the target leverage for this position." /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
              <details className="group mt-4 rounded-xl border border-[var(--line)] px-3"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary><div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div></details>
            </Card>
            <ActionReview planBuilder={planBuilder} label={action === 'reduce' && fraction === 100 ? 'Review close' : `Review ${action}`} operationLabel={action === 'reduce' && fraction === 100 ? `Close ${selected?.market} position` : `${action[0].toUpperCase()}${action.slice(1)} ${selected?.market} position`} onComplete={load} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Header({ icon: Icon, title, body }: { icon: typeof ArrowUpRight; title: string; body: string }) { return <div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-mint" aria-hidden="true" /><h2 className="text-[15px] font-semibold">{title}</h2></div><p className="mt-1 text-[12px] text-mut">{body}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[rgba(255,255,255,.035)] p-3"><span className="block text-[11px] text-mut">{label}</span><span className="mt-1 block truncate text-[13px] font-semibold tabular-nums" title={value}>{value}</span></div>; }
