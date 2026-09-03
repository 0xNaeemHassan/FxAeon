'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gauge, Layers2, X } from 'lucide-react';
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
import { haptic } from '@/lib/telegram';
import {
  getSdkReductionAmountWei,
  parseAmount,
  positionKey,
  positionInputTokenOptions,
  positionOutputTokenOptions,
  tokenAddress,
  tokenDecimals,
  type UiToken,
} from '@/app/trade/fxUi';

type PositionAction = 'increase' | 'reduce' | 'close' | 'leverage';

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
  const managerRef = useRef<HTMLElement>(null);
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
    ? action === 'reduce' || action === 'close'
      ? positionOutputTokenOptions(selected.market, selected.side)
      : positionInputTokenOptions(selected.market)
    : positionInputTokenOptions('ETH');
  const validAmount = positiveDecimal(amount, tokenDecimals(token));

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
    if (action === 'reduce' || action === 'close') {
      return async () => {
        const reductionFraction = action === 'close' ? 100 : fraction;
        const reduction = await getSdkReductionAmountWei({
          market: selected.market,
          side: selected.side,
          rawCollateralWei: selected.info.rawColls,
          rawDebtWei: selected.info.rawDebts,
          fractionBps: reductionFraction * 100,
        });
        return planReducePosition({ ...common, amount: reduction, outputTokenAddress: tokenAddress(token), isClosePosition: action === 'close' });
      };
    }
    if (!Number.isFinite(leverage) || leverage < leverageBounds.min || leverage > leverageBounds.max) return null;
    return () => planAdjustPositionLeverage({ ...common, leverage });
  }, [action, fraction, leverage, leverageBounds, selected, selectedStale, slippage, token, validAmount, wallet.address]);

  const openManager = (key: string, nextAction: PositionAction) => {
    setSelectedKey(key);
    setAction(nextAction);
    setAmount('');
    if (nextAction === 'close') setFraction(100);
    haptic(nextAction === 'close' ? 'warning' : 'selection');
    window.requestAnimationFrame(() => managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const reviewLabel = action === 'close' ? 'Review close' : `Review ${action}`;
  const operationLabel = action === 'close'
    ? `Close ${selected?.market} ${selected?.side} position`
    : `${action[0].toUpperCase()}${action.slice(1)} ${selected?.market} position`;

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
          <div className={styles.positionManagerGrid}>
            <section className={styles.positionsColumn} aria-labelledby="open-positions-heading">
              <div className={styles.positionSectionHeader}>
                <div><p className={styles.ticketKicker}>Your portfolio</p><h2 id="open-positions-heading">Open positions</h2></div>
                <span>{positions.length} live</span>
              </div>
              <div className={styles.positionList} aria-label="Open positions">
                {positions.map((position) => {
                  const key = positionKey(position);
                  const isSelected = key === selectedKey;
                  return (
                    <div key={key} className={styles.positionListItem}>
                      <ProtocolPositionCard
                        position={position}
                        compact
                        selected={isSelected}
                        stale={positionIsStale(position, positionState.failedGroups)}
                        onSelect={() => setSelectedKey(key)}
                      />
                      <div className={styles.positionQuickActions} aria-label={`Actions for ${position.market} ${position.side} position ${position.info.positionId}`}>
                        <button type="button" onClick={() => openManager(key, isSelected ? action : 'increase')} className="glass-press">Manage</button>
                        <button type="button" onClick={() => openManager(key, 'close')} className="glass-press"><X aria-hidden="true" /> Close</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section ref={managerRef} className={styles.positionManageColumn} aria-labelledby="manage-position-heading">
              {selected && <div className={styles.manageHeading}><div><p className={styles.ticketKicker}>Selected position</p><h2 id="manage-position-heading">{selected.market} {selected.side} · #{selected.info.positionId}</h2></div>{selected.side === 'long' && <Link href="/borrow" className="glass-press inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-[12px] font-semibold text-mint">Manage debt <span aria-hidden="true">→</span></Link>}</div>}
              {selectedStale && <p role="status" className="rounded-xl border border-[rgba(255,194,102,.2)] bg-[rgba(255,194,102,.08)] p-3 text-[12px] text-warn">Refresh this position before reviewing an action. Its retained balances are not a live quote.</p>}

              <div className={styles.positionActions}><Segmented value={action} onChange={setAction} ariaLabel="Position action" options={[{ value: 'increase', label: 'Add' }, { value: 'reduce', label: 'Reduce' }, { value: 'close', label: 'Close' }, { value: 'leverage', label: 'Leverage' }]} /></div>
              <Card className={styles.actionPanel}>
                {action === 'increase' && <div className={styles.fieldStack}><Header icon={ArrowUpRight} title="Increase exposure" body="Add collateral and choose the target leverage for this position." /><TokenSelect label="Input asset" value={token} options={marketTokens} onChange={setToken} {...tokenBalanceProps} /><AmountField label="Amount to add" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} balanceState={selectedTokenBalance} /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
                {action === 'reduce' && <div className={styles.fieldStack}><Header icon={ArrowDownRight} title="Reduce exposure" body="Choose how much of this position to reduce and what asset to receive." /><RangeField label="Position reduction" value={fraction} onChange={setFraction} min={1} max={99} step={1} suffix="%" /><div className="grid grid-cols-3 gap-2">{[25, 50, 75].map((value) => <button key={value} type="button" aria-pressed={fraction === value} onClick={() => setFraction(value)} className={`min-h-11 rounded-xl text-[11px] font-semibold ${fraction === value ? 'bg-[var(--mint-dim)] text-mint' : 'bg-[rgba(255,255,255,.035)] text-mut'}`}>{value}%</button>)}</div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={setToken} {...tokenBalanceProps} /></div>}
                {action === 'close' && <div className={styles.fieldStack}><Header icon={X} title="Close the full position" body="Unwind 100% of this position through the official f(x) route and choose the asset returned to your wallet." /><div className={styles.closeNotice}><strong>Full close</strong><span>All remaining collateral and debt</span><small>The review will show the route, limits, approvals, and exact transaction count before your wallet opens.</small></div><TokenSelect label="Receive asset" value={token} options={marketTokens} onChange={setToken} {...tokenBalanceProps} /></div>}
                {action === 'leverage' && <div className={styles.fieldStack}><Header icon={Gauge} title="Adjust leverage" body="Set the target leverage for this position." /><LeverageField label={selected?.side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} /></div>}
                <details className={`${styles.advancedDetails} group mt-4 rounded-xl border border-[var(--line)] px-3`}><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary><div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div></details>
              </Card>
              <div className={styles.reviewWrap}><ActionReview planBuilder={planBuilder} label={reviewLabel} operationLabel={operationLabel} destructive={action === 'close'} onComplete={async () => { await Promise.all([positionState.refresh(), walletBalances.refresh()]); }} /></div>
            </section>
          </div>
        ) : null}
      </div>
      </div>
    </AppShell>
  );
}

function Header({ icon: Icon, title, body }: { icon: typeof ArrowUpRight; title: string; body: string }) { return <div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-mint" aria-hidden="true" /><h2 className="text-[15px] font-semibold">{title}</h2></div><p className="mt-1 text-[12px] text-mut">{body}</p></div>; }
