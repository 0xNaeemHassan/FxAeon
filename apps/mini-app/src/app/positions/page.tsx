'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gauge, Layers2 } from 'lucide-react';
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
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planAdjustPositionLeverage, planIncreasePosition, planReducePosition, readLeverageBounds, type LeverageBounds } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/trade-surfaces.module.css';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import {
  getSdkReductionAmountWei,
  parseAmount,
  positionCollateralDecimals,
  positionKey,
  positionInputTokenOptions,
  positionOutputTokenOptions,
  tokenAddress,
  tokenDecimals,
  type UiToken,
} from '@/app/trade/fxUi';

type PositionAction = 'increase' | 'reduce' | 'leverage';

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
  const walletBalances = useWalletTokenBalances(wallet.address, 1);
  const balanceStatus = walletBalances.status === 'idle' ? 'loading' as const : walletBalances.status;
  const tokenBalanceProps = wallet.address ? { balances: walletBalances.balances, balanceStatus } : {};
  const selectedTokenBalance: TokenBalanceView | undefined = wallet.address
    ? tokenBalanceFor(walletBalances.balances, token) ?? { status: balanceStatus === 'ready' ? 'unavailable' : balanceStatus }
    : undefined;

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);
  useEffect(() => {
    setSelectedKey((current) => current && positions.some((position) => positionKey(position) === current)
      ? current
      : positions[0] ? positionKey(positions[0]) : '');
  }, [positions]);

  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const selectedStale = selected ? positionIsStale(selected, positionState.failedGroups) : false;
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
    // This is an editable target, not the measured position metric. Seed a
    // readable target and pass that exact displayed value into the review.
    const targetLeverage = Number(Math.max(0.1, sdkLeverage).toFixed(2));
    setLeverage(clampLeverage(targetLeverage, leverageBounds));
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
    if (!Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max) return null;
    return () => planAdjustPositionLeverage({ ...common, leverage });
  }, [action, fraction, leverage, leverageBounds, selected, selectedStale, slippage, token, validAmount, wallet.address]);

  return (
    <AppShell title="Positions">
      <div className={styles.positionsRoot}>
      <div className={styles.positionsWorkspace}>
        <div className="grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[var(--input)] p-1" aria-label="Trade views">
          <Link href="/trade" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">New position</Link>
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">Positions</span>
        </div>
        {!wallet.address ? (
          <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to see and manage your open positions." />
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
          <EmptyState icon={Layers2} title="Position state unavailable" body="FxAeon could not verify any position pool. Your wallet remains connected; retry when Ethereum responds." />
        ) : wallet.address && positionState.status === 'partial' && !positions.length && !positionState.pendingPositions.length ? (
          <EmptyState icon={Layers2} title="No positions in verified pools" body="At least one position pool is unavailable, so FxAeon cannot confirm that this wallet has no open positions." />
        ) : wallet.address && positionState.status === 'ready' && !positions.length && !positionState.pendingPositions.length ? (
          <EmptyState icon={Layers2} title="No open positions" body="Open an ETH or BTC position to get started." action={<Link href="/trade" className="button button-primary flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold">Open a position</Link>} />
        ) : wallet.address && positions.length > 0 ? (
          <>
            <div className={styles.positionList} aria-label="Open positions">
              {positions.map((position) => (
                <ProtocolPositionCard
                  key={positionKey(position)}
                  position={position}
                  compact={positionKey(position) !== selectedKey}
                  selected={positionKey(position) === selectedKey}
                  stale={positionIsStale(position, positionState.failedGroups)}
                  onSelect={() => setSelectedKey(positionKey(position))}
                />
              ))}
            </div>

            {selected && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[14px] font-semibold">Manage {selected.market} {selected.side} · #{selected.info.positionId}</h2>{selected.side === 'long' && <Link href="/borrow" className="glass-press inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-[12px] font-semibold text-mint">Manage debt <span aria-hidden="true">→</span></Link>}</div>}
            {selectedStale && <p role="status" className="text-[12px] text-warn">Refresh this position before reviewing an action. Its retained balances are not a live quote.</p>}

            <div className={styles.positionActions}><Segmented value={action} onChange={setAction} ariaLabel="Position action" options={[{ value: 'increase', label: 'Increase' }, { value: 'reduce', label: 'Reduce' }, { value: 'leverage', label: 'Leverage' }]} /></div>
            <Card className={styles.actionPanel}>
              {action === 'increase' && <div className={styles.fieldStack}><Header icon={ArrowUpRight} title="Increase exposure" body="Add collateral and choose the target leverage for this position." /><TokenSelect label="Input asset" value={token} options={marketTokens} onChange={setToken} {...tokenBalanceProps} /><AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} balanceState={selectedTokenBalance} /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
              {action === 'reduce' && <div className={styles.fieldStack}><Header icon={ArrowDownRight} title={fraction === 100 ? 'Close position' : 'Reduce exposure'} body="Choose how much of this position to reduce and what asset to receive." /><RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={100} step={1} suffix="%" /><div className="grid grid-cols-4 gap-2">{[25, 50, 75, 100].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`min-h-11 rounded-xl text-[11px] font-semibold ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.035)] text-mut'}`}>{value === 100 ? 'Close' : `${value}%`}</button>)}</div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={setToken} {...tokenBalanceProps} /></div>}
              {action === 'leverage' && <div className={styles.fieldStack}><Header icon={Gauge} title="Adjust leverage" body="Set the target leverage for this position." /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
              <details className={`${styles.advancedDetails} group mt-4 rounded-xl border border-[var(--line)] px-3`}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary><div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div></details>
            </Card>
            <div className={styles.reviewWrap}><ActionReview planBuilder={planBuilder} label={action === 'reduce' && fraction === 100 ? 'Review close' : `Review ${action}`} operationLabel={action === 'reduce' && fraction === 100 ? `Close ${selected?.market} position` : `${action[0].toUpperCase()}${action.slice(1)} ${selected?.market} position`} onComplete={async () => { await Promise.all([positionState.refresh(), walletBalances.refresh()]); }} /></div>
          </>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}

function Header({ icon: Icon, title, body }: { icon: typeof ArrowUpRight; title: string; body: string }) { return <div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-mint" aria-hidden="true" /><h2 className="text-[15px] font-semibold">{title}</h2></div><p className="mt-1 text-[12px] text-mut">{body}</p></div>; }
