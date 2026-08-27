'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gauge, Layers2, RefreshCw } from 'lucide-react';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, LeverageField, RangeField, Segmented, SlippageField, TokenSelect } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, planAdjustPositionLeverage, planIncreasePosition, planReducePosition } from '@/lib/fx';
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
    setLeverage(Math.max(0.1, sdkLeverage));
  }, [marketTokens, selected]);

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
    <AppShell title="Positions" subtitle="Read live ETH/BTC positions, then use only the official increase, reduce, close, and leverage methods.">
      <div className="stagger flex flex-col gap-3.5">
        {!wallet.address ? (
          <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to read live ETH/BTC positions from Ethereum and authorize position actions." />
        ) : loading && !positions.length ? (
          <LoadingRegion label="Reading positions from the official SDK" className="flex flex-col gap-3.5"><Skeleton className="h-24" /><Skeleton className="h-48" /></LoadingRegion>
        ) : error ? (
          <EmptyState icon={RefreshCw} title="Position read unavailable" body={error} action={<Button onClick={() => void load()}>Retry</Button>} />
        ) : !positions.length ? (
          <EmptyState icon={Layers2} title="No open positions" body="The SDK returned no positions across ETH/BTC long/short pools. Open one from Trade." />
        ) : (
          <>
            <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Open positions">
              {positions.map((position) => {
                const active = positionKey(position) === selectedKey;
                return (
                  <button key={positionKey(position)} type="button" role="radio" aria-checked={active} onClick={() => setSelectedKey(positionKey(position))} className={`glass-press min-w-[178px] snap-start rounded-[20px] border p-3.5 text-left ${active ? 'border-[rgba(139,109,255,.5)] bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-display text-[15px] font-semibold">{position.market}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${position.side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{position.side}</span></div>
                    <p className="mt-3 text-[19px] font-semibold">{(position.side === 'short' ? position.info.lsdLeverage : position.info.currentLeverage).toFixed(2)}×</p>
                    <p className="mt-0.5 truncate text-[10px] text-mut">#{position.info.positionId} · {formatAmount(position.info.rawColls, positionCollateralDecimals(position))} {position.info.rawCollsToken}</p>
                  </button>
                );
              })}
            </div>

            {selected && <Card glow className="p-4"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mut">Selected position</span><h2 className="text-display mt-1 text-[18px] font-semibold">{selected.market} {selected.side} · #{selected.info.positionId}</h2></div><button type="button" onClick={() => void load()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint" aria-label="Refresh positions"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div><div className="mt-4 grid grid-cols-2 gap-2"><Metric label="Collateral" value={`${formatAmount(selected.info.rawColls, positionCollateralDecimals(selected))} ${selected.info.rawCollsToken}`} /><Metric label="Debt" value={`${formatAmount(selected.info.rawDebts, positionDebtDecimals(selected))} ${selected.info.rawDebtsToken}`} /><Metric label="SDK leverage" value={`${(selected.side === 'short' ? selected.info.lsdLeverage : selected.info.currentLeverage).toFixed(2)}×`} /><Metric label="Position ID" value={`#${selected.info.positionId}`} /></div><p className="mt-3 text-[10.5px] leading-relaxed text-mut">Short-pool leverage is shown in the SDK’s lsdLeverage units. Health, PnL, liquidation price, and market prices are not returned by the official SDK, so FxAeon does not invent them.</p></Card>}

            <Segmented value={action} onChange={setAction} ariaLabel="Position action" options={[{ value: 'increase', label: 'Increase' }, { value: 'reduce', label: 'Reduce / close' }, { value: 'leverage', label: 'Leverage' }]} />
            <Card className="p-4">
              {action === 'increase' && <div className="flex flex-col gap-4"><Header icon={ArrowUpRight} title="Increase exposure" body="Add an SDK-supported asset and choose the target leverage for the selected position." /><TokenSelect label="Input asset" value={token} options={marketTokens} onChange={setToken} /><AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} /><InfoNote>The SDK route preserves the selected position ID and computes the resulting leverage from live pool state. Review the returned route before approving.</InfoNote></div>}
              {action === 'reduce' && <div className="flex flex-col gap-4"><Header icon={ArrowDownRight} title={fraction === 100 ? 'Close position' : 'Reduce exposure'} body="The SDK amount is derived from the live side-specific position state." /><RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={100} step={1} suffix="%" /><div className="grid grid-cols-4 gap-2">{[25, 50, 75, 100].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`min-h-11 rounded-xl text-[11px] font-semibold ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.035)] text-mut'}`}>{value === 100 ? 'Close' : `${value}%`}</button>)}</div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={setToken} /><InfoNote>Close is an official reduce operation with isClosePosition=true. No off-chain estimate is shown.</InfoNote></div>}
              {action === 'leverage' && <div className="flex flex-col gap-4"><Header icon={Gauge} title="Adjust leverage" body="Set a positive target; the SDK validates the live pool bounds." /><LeverageField label="Target leverage" value={leverage} onChange={setLeverage} /><InfoNote>The protocol route and bounds are authoritative. FxAeon does not display an invented health score.</InfoNote></div>}
              <div className="mt-4"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div>
            </Card>
            <ActionReview planBuilder={planBuilder} label={action === 'reduce' && fraction === 100 ? 'Review close' : `Review ${action}`} operationLabel={action === 'reduce' && fraction === 100 ? `Close ${selected?.market} position` : `${action[0].toUpperCase()}${action.slice(1)} ${selected?.market} position`} onComplete={load} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Header({ icon: Icon, title, body }: { icon: typeof ArrowUpRight; title: string; body: string }) { return <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-5 w-5" /></span><div><h2 className="text-[14px] font-semibold">{title}</h2><p className="mt-0.5 text-[10.5px] text-mut">{body}</p></div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[rgba(255,255,255,.035)] p-3"><span className="block text-[9px] uppercase tracking-[0.1em] text-mut">{label}</span><span className="mt-1 block truncate text-[12px] font-semibold">{value}</span></div>; }
