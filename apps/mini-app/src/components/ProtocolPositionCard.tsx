'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, RefreshCw } from 'lucide-react';
import React from 'react';
import {
  formatAmount,
  positionDisplayLeverage,
  positionKey,
  positionTokenDecimals,
  type PositionGroupFailure,
  type UiPosition,
} from '@/app/trade/fxUi';
import { useUsdPrices } from '@/components/PriceProvider';
import TokenIcon from '@/components/TokenIcon';
import { priceKeyForSymbol } from '@/lib/prices';
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';

function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

function positionValuation(position: UiPosition, prices: ReturnType<typeof useUsdPrices>['prices']) {
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  return calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
}

function PositionBody({
  position,
  compact,
  stale,
}: {
  position: UiPosition;
  compact: boolean;
  stale: boolean;
}) {
  const { prices, status: priceStatus } = useUsdPrices();
  const collateral = formatAmount(position.info.rawColls, positionTokenDecimals(position, 'collateral'));
  const debt = formatAmount(position.info.rawDebts, positionTokenDecimals(position, 'debt'));
  const valuation = positionValuation(position, prices);
  const netEquity = formatUsdCents(valuation.netEquityUsdCents);
  const collateralUsd = valuation.collateralUsdCents === null ? 'USD unavailable' : formatUsdCents(valuation.collateralUsdCents);
  const debtUsd = valuation.debtUsdCents === null ? 'USD unavailable' : formatUsdCents(valuation.debtUsdCents);
  const leverageInfo = positionDisplayLeverage(position);
  const leverage = leverageInfo.value !== null
    ? `${leverageInfo.value.toFixed(2).replace(/\.00$/, '')}×`
    : '—';

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <TokenIcon symbol={position.market === 'ETH' ? 'ETH' : 'WBTC'} size={compact ? 34 : 40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-display text-[15px] font-semibold ${position.side === 'long' ? 'text-success' : 'text-danger'}`}>{position.market} {position.side === 'long' ? 'Long' : 'Short'}</span>
            {stale && <span className="rounded-full bg-[rgba(255,194,102,.12)] px-2 py-0.5 text-[12px] font-semibold text-warn">Last verified</span>}
          </div>
          <p className="mt-1 text-[12px] text-mut">#{position.info.positionId} · {leverage} {leverageInfo.label}</p>
        </div>
        <div className="ml-auto min-w-0 max-w-full shrink basis-[88px] text-right" title={valuation.netEquityUsdCents === null ? 'Validated USD pricing is unavailable' : 'Estimated collateral value less debt value; display-only'}>
          <span className="block text-[11px] text-mut">Est. net equity</span>
          <span className="mt-0.5 block break-words text-[14px] font-semibold tabular-nums">{netEquity}</span>
          {valuation.netEquityUsdCents === null && <span className="block text-[10px] text-mut">USD unavailable</span>}
          {priceStatus === 'stale' && <span className="block text-[10px] text-mut">Last prices</span>}
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--mut-2)]" aria-hidden="true" />
      </div>
      {compact ? (
        <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-2">
          <div className="min-w-0"><span className="text-[12px] text-mut">Collateral</span><p className="mt-0.5 break-words text-[13px] font-semibold">{collateral} {position.info.rawCollsToken}</p><p className="mt-0.5 text-[11px] text-mut">{collateralUsd}</p></div>
          <div className="min-w-0"><span className="text-[12px] text-mut">Debt</span><p className="mt-0.5 break-words text-[13px] font-semibold">{debt} {position.info.rawDebtsToken}</p><p className="mt-0.5 text-[11px] text-mut">{debtUsd}</p></div>
        </div>
      ) : <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
          <span className="text-[12px] text-mut">Collateral value</span>
          <p className="mt-1 break-words text-[13px] font-semibold">{collateral} {position.info.rawCollsToken}</p>
          <p className="mt-0.5 text-[12px] text-mut">{collateralUsd}</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
          <span className="text-[12px] text-mut">Debt value</span>
          <p className="mt-1 break-words text-[13px] font-semibold">{debt} {position.info.rawDebtsToken}</p>
          <p className="mt-0.5 text-[12px] text-mut">{debtUsd}</p>
        </div>
      </div>}
    </>
  );
}

export function ProtocolPositionCard({
  position,
  compact = false,
  highlighted = false,
  selected = false,
  stale = false,
  href,
  onSelect,
  onNavigate,
  className = '',
}: {
  position: UiPosition;
  compact?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  stale?: boolean;
  href?: string;
  onSelect?: () => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const classes = `astryx-card ${href || onSelect ? 'glass-press' : ''} block w-full rounded-2xl border p-3.5 text-left transition ${selected ? 'border-[var(--mint)] bg-[var(--surface-2)]' : 'border-[var(--line)]'} ${highlighted ? 'ring-2 ring-[var(--success)] ring-offset-2 ring-offset-[var(--bg)]' : ''} ${className}`;
  const body = <PositionBody position={position} compact={compact} stale={stale} />;

  if (href) {
    return <Link href={href} onClick={onNavigate} className={classes} data-position-key={positionKey(position)}>{body}</Link>;
  }
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={classes} aria-pressed={selected} data-position-key={positionKey(position)}>
        {body}
      </button>
    );
  }
  return <article className={classes} data-position-key={positionKey(position)}>{body}</article>;
}

export { positionIsStale } from '@/app/trade/fxUi';

export function ProtocolPositionNotice({
  status,
  failedGroups,
  hasPositions,
  refreshing,
  onRefresh,
  compact = false,
}: {
  status: 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';
  failedGroups: readonly PositionGroupFailure[];
  hasPositions: boolean;
  refreshing: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  if (status === 'idle' || status === 'loading' || status === 'ready') return null;
  const groups = failedGroups.map((group) => `${group.market} ${group.side}`).join(', ');
  const message = status === 'partial'
    ? `Could not refresh ${groups || 'some positions'}. Affected positions show their last verified balances.`
    : hasPositions
      ? 'Could not refresh your positions. Showing last verified balances.'
      : 'Positions are temporarily unavailable. Try refreshing.';

  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-xl border border-[rgba(255,194,102,.2)] bg-[rgba(255,194,102,.08)] text-warn ${compact ? 'p-2.5' : 'p-3'}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-[12px] leading-relaxed">{message}</p>
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Retry position verification" className="glass-press flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function ProtocolPositionSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div role="status" aria-label="Loading positions" className="astryx-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-[var(--elevation-1)]">
      <div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="mt-2 h-3 w-24" /></div></div>
      {!compact && <div className="mt-3 grid grid-cols-2 gap-2"><Skeleton className="h-16 rounded-lg" /><Skeleton className="h-16 rounded-lg" /></div>}
    </div>
  );
}
