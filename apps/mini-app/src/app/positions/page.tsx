'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PROTOCOL_TOKENS, RISK_PARAMS } from '@fxaeon/shared';
import { Activity, ArrowDownRight, ArrowUpRight, Gauge, Layers2, RefreshCw, Share2 } from 'lucide-react';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { HealthGauge } from '@/components/HealthGauge';
import { SharePnLModal, type PnLData } from '@/components/SharePnLModal';
import { AmountField, InfoNote, RangeField, Segmented, TokenSelect } from '@/components/ProtocolForm';
import {
  getMe,
  type ApiPosition,
  type Me,
  type MiniActionParams,
  type ProtocolTokenSymbol,
} from '@/lib/api';
import { positiveDecimal } from '@/lib/amount';
import { useLiveRefresh } from '@/lib/useLiveRefresh';

type PositionAction = 'increase' | 'reduce' | 'leverage';

const INPUTS: Record<'wstETH' | 'WBTC', readonly ProtocolTokenSymbol[]> = {
  wstETH: ['ETH', 'WETH', 'stETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'],
  WBTC: ['WBTC', 'USDC', 'USDT', 'fxUSD'],
};

function outputs(position: ApiPosition): readonly ProtocolTokenSymbol[] {
  if (position.market === 'WBTC') return INPUTS.WBTC;
  return position.side === 'short'
    ? ['ETH', 'WETH', 'wstETH', 'USDC', 'USDT', 'fxUSD']
    : INPUTS.wstETH;
}

export default function PositionsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [positionKey, setPositionKey] = useState('');
  const [action, setAction] = useState<PositionAction>('increase');
  const [token, setToken] = useState<ProtocolTokenSymbol>('ETH');
  const [amount, setAmount] = useState('');
  const [fraction, setFraction] = useState(25);
  const [leverage, setLeverage] = useState(2);
  const [shareData, setShareData] = useState<PnLData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const account = await getMe();
      setMe(account);
      const first = account.positions?.[0];
      setPositionKey((current) => {
        if (current && account.positions?.some((position) => keyOf(position) === current)) return current;
        return first ? keyOf(first) : '';
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Positions are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const selected = (me?.positions ?? []).find((position) => keyOf(position) === positionKey);
  const market = selected?.market === 'WBTC' ? 'WBTC' : 'wstETH';
  const side = selected?.side ?? 'long';
  const maxLeverage = side === 'long'
    ? RISK_PARAMS.MAX_LEVERAGE_LONG
    : RISK_PARAMS.MAX_LEVERAGE_SHORT;

  useEffect(() => {
    if (!selected) return;
    const options = action === 'reduce' ? outputs(selected) : INPUTS[market];
    if (!options.includes(token)) setToken(options[0]);
    setLeverage(Math.min(maxLeverage, Math.max(RISK_PARAMS.MIN_LEVERAGE, selected.leverage)));
  }, [action, market, maxLeverage, selected, token]);

  const params = useMemo<MiniActionParams | null>(() => {
    if (!selected) return null;
    const common = {
      market,
      side,
      positionId: Number(selected.tokenId),
    } as const;
    if (action === 'increase') {
      const validAmount = positiveDecimal(amount, PROTOCOL_TOKENS[token].decimals);
      return validAmount ? { kind: 'position_increase', ...common, inputToken: token, amount: validAmount } : null;
    }
    if (action === 'reduce') {
      return { kind: 'position_reduce', ...common, outputToken: token, fractionBps: fraction * 100 };
    }
    return { kind: 'position_adjust', ...common, leverage };
  }, [action, amount, fraction, leverage, market, selected, side, token]);

  return (
    <AppShell title="Positions" subtitle="Add, reduce, close, or rebalance every live f(x) position.">
      <div className="stagger flex flex-col gap-3.5">
        {loading ? (
          <LoadingRegion label="Loading open positions" className="flex flex-col gap-3.5">
            <Skeleton className="h-28" /><Skeleton className="h-80" />
          </LoadingRegion>
        ) : error ? (
          <EmptyState
            icon={RefreshCw}
            title="Positions unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : !me?.positions?.length ? (
          <EmptyState icon={Layers2} title="No open positions" body="Create a leveraged position from Trade or a collateralized borrowing position from Borrow." />
        ) : (
          <>
            <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Open positions">
              {me.positions.map((position, index) => {
                const active = keyOf(position) === positionKey;
                return (
                  <button
                    key={keyOf(position)}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setPositionKey(keyOf(position))}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const next = event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? me.positions!.length - 1
                          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + me.positions!.length) % me.positions!.length;
                      const nextPosition = me.positions![next];
                      setPositionKey(keyOf(nextPosition));
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                    }}
                    className={`glass-press min-w-[164px] snap-start rounded-[20px] border p-3.5 text-left ${
                      active ? 'border-[rgba(139,109,255,.5)] bg-[var(--mint-dim)]' : 'border-[var(--line)] bg-[var(--surface)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-display text-[15px] font-semibold">{position.market}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${position.side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{position.side}</span>
                    </div>
                    <p className="mt-3 text-[20px] font-semibold">{position.leverage.toFixed(2)}×</p>
                    <p className="mt-0.5 truncate text-[10px] text-mut">#{position.tokenId} · {position.collateral} {position.collateralToken ?? position.market}</p>
                  </button>
                );
              })}
            </div>

            {selected && (
              <Card glow className="p-4">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mut">Selected Position</span>
                    <h3 className="text-display text-[16px] font-semibold">{selected.market} · #{selected.tokenId}</h3>
                  </div>
                  <Button
                    variant="ghost"
                    className="min-h-9 w-auto px-3 py-1 text-[12px]"
                    onClick={() =>
                      setShareData({
                        market: selected.market,
                        side: selected.side,
                        leverage: selected.leverage,
                        pnlUsd: selected.pnlUsd,
                        pnlPct: selected.pnlPct,
                        entryPrice: selected.entryPrice,
                        referralCode: me.referralCode ?? undefined,
                      })
                    }
                  >
                    <Share2 className="h-3.5 w-3.5" /> Share PnL
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Metric label="Collateral" value={`${selected.collateral} ${selected.collateralToken ?? selected.market}`} />
                  <Metric label="Debt" value={`${selected.debt} ${selected.debtToken ?? 'fxUSD'}`} />
                  <Metric label="Health" value={`${Math.round(selected.healthPercent * 100)}%`} tone={selected.healthPercent < 0.25 ? 'danger' : selected.healthPercent < 0.5 ? 'warn' : 'good'} />
                </div>
                <div className="mt-3">
                  <HealthGauge
                    mode="health"
                    value={selected.healthPercent}
                    side={selected.side}
                    market={selected.market}
                  />
                </div>
              </Card>
            )}

            <Segmented
              value={action}
              onChange={setAction}
              ariaLabel="Position action"
              options={[
                { value: 'increase', label: 'Add' },
                { value: 'reduce', label: 'Reduce' },
                { value: 'leverage', label: 'Leverage' },
              ]}
            />

            {selected && (
              <Card className="p-4">
                {action === 'increase' && (
                  <div className="flex flex-col gap-4">
                    <Header icon={ArrowUpRight} title="Increase exposure" body="Add any SDK-supported input token to this position." />
                    <TokenSelect label="Pay with" value={token} options={INPUTS[market]} onChange={setToken} />
                    <AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} balance={me.funding?.balances?.[token]} maxDecimals={PROTOCOL_TOKENS[token].decimals} />
                    <InfoNote>The SDK targets the existing position ID. Current leverage is preserved while exposure increases.</InfoNote>
                  </div>
                )}
                {action === 'reduce' && (
                  <div className="flex flex-col gap-4">
                    <Header icon={ArrowDownRight} title={fraction === 100 ? 'Close position' : 'Reduce exposure'} body="Choose how much to unwind and which supported asset to receive." />
                    <RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={100} step={1} suffix="%" />
                    <div className="grid grid-cols-4 gap-2">
                      {[25, 50, 75, 100].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`min-h-11 rounded-xl text-[11px] font-semibold ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.035)] text-mut'}`}>{value === 100 ? 'Close' : `${value}%`}</button>)}
                    </div>
                    <TokenSelect label="Receive as" value={token} options={outputs(selected)} onChange={setToken} />
                    <InfoNote>The SDK converts this percentage into the correct market units. The live review is the authoritative receive route.</InfoNote>
                  </div>
                )}
                {action === 'leverage' && (
                  <div className="flex flex-col gap-4">
                    <Header icon={Gauge} title="Adjust leverage" body="Rebalance the existing position without closing it." />
                    <RangeField label="Target leverage" value={leverage} onChange={setLeverage} min={RISK_PARAMS.MIN_LEVERAGE} max={maxLeverage} step={0.1} />
                    <HealthGauge mode="leverage" value={leverage} side={side} market={market} />
                    <InfoNote>Increasing leverage reduces liquidation headroom. The final route and health implications are checked during simulation.</InfoNote>
                  </div>
                )}
              </Card>
            )}

            <ActionReview params={params} label={action === 'reduce' && fraction === 100 ? 'Review close' : `Review ${action}`} onComplete={() => void load()} />

            {shareData && (
              <SharePnLModal
                isOpen={Boolean(shareData)}
                onClose={() => setShareData(null)}
                data={shareData}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function keyOf(position: ApiPosition): string {
  return `${position.market}:${position.side}:${position.tokenId}`;
}

function Header({ icon: Icon, title, body }: { icon: typeof Activity; title: string; body: string }) {
  return <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Icon className="h-5 w-5" /></span><div><h2 className="text-[14px] font-semibold">{title}</h2><p className="mt-0.5 text-[10.5px] text-mut">{body}</p></div></div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'danger' }) {
  const cls = tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : '';
  return <div className="min-w-0 rounded-2xl bg-[rgba(255,255,255,.035)] p-2.5"><span className="block text-[8.5px] uppercase tracking-[0.1em] text-mut">{label}</span><span className={`mt-1 block truncate text-[10.5px] font-semibold ${cls}`}>{value}</span></div>;
}
