'use client';

import Link from 'next/link';
import { AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';
import React from 'react';
import {
  formatAmount,
  positionDisplayLeverage,
  positionKey,
  positionTokenDecimals,
  type PositionGroupFailure,
  type UiPosition,
} from '@/app/trade/fxUi';
import { useLiveMarketQuote, useUsdPrices } from '@/components/PriceProvider';
import { MissingValue } from '@/components/MissingValue';
import TokenIcon from '@/components/TokenIcon';
import { formatUsdPrice, priceKeyForSymbol } from '@/lib/prices';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { calculatePositionUsdValuation, debtCollateralRatioPercent, formatUsdCents } from '@/lib/positionValuation';
import styles from './ProtocolPositionCard.module.css';

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
  interactive,
}: {
  position: UiPosition;
  compact: boolean;
  interactive: boolean;
}) {
  const priceSnapshot = useUsdPrices();
  const prices = freshDisplayPrices(priceSnapshot);
  const { quote: liveQuote, isFresh: hasFreshLiveQuote } = useLiveMarketQuote(position.market);
  const collateral = formatAmount(position.info.rawColls, positionTokenDecimals(position, 'collateral'));
  const debt = formatAmount(position.info.rawDebts, positionTokenDecimals(position, 'debt'));
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  // Validate each display quote independently, including retained quotes.
  const valuation = positionValuation(position, prices);
  const missingStatus = priceSnapshot.status === 'loading' ? 'loading' as const : 'unavailable' as const;
  const netEquity = valuation.netEquityUsdCents === null
    ? <MissingValue width="lg" status={missingStatus} />
    : `≈ ${formatUsdCents(valuation.netEquityUsdCents)}`;
  const collateralUsd = valuation.collateralUsdCents === null
    ? <MissingValue width="md" status={missingStatus} />
    : `≈ ${formatUsdCents(valuation.collateralUsdCents)}`;
  const debtUsd = valuation.debtUsdCents === null
    ? <MissingValue width="md" status={missingStatus} />
    : `≈ ${formatUsdCents(valuation.debtUsdCents)}`;
  const marketKey = position.market === 'ETH' ? 'ETH' : 'WBTC';
  const marketPrice = hasFreshLiveQuote
    ? liveQuote?.price
    : prices[marketKey];
  const marketPriceDisplay = marketPrice === undefined || !Number.isFinite(marketPrice)
    ? <MissingValue width="lg" status={missingStatus} />
    : formatUsdPrice(marketPrice);
  const debtCollateralRatio = debtCollateralRatioPercent({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionTokenDecimals(position, 'collateral'),
    collateralPrice: !collateralKey ? undefined : prices[collateralKey],
    debtRaw: position.info.rawDebts,
    debtDecimals: positionTokenDecimals(position, 'debt'),
    debtPrice: !debtKey ? undefined : prices[debtKey],
  });
  const leverageInfo = positionDisplayLeverage(position);
  const leverage = leverageInfo.value !== null
    ? `${leverageInfo.value.toFixed(2).replace(/\.00$/, '')}×`
    : <MissingValue width="sm" status="loading" />;
  const debtCollateralDisplay = debtCollateralRatio ?? <MissingValue width="md" status={missingStatus} />;
  const positionValueTitle = valuation.netEquityUsdCents === null
    ? missingStatus === 'loading' ? 'Loading position value' : 'Position value unavailable until prices refresh'
    : 'Collateral value minus debt';
  const sideLabel = position.side === 'long' ? 'Long' : 'Short';

  return (
    <div className={`${styles.content} ${compact ? styles.compactContent : ''}`}>
      <div className={styles.identity}>
        <div className={styles.tokenIcon}>
        <TokenIcon symbol={position.market === 'ETH' ? 'ETH' : 'WBTC'} size={compact ? 34 : 40} />
        </div>
        <div className={styles.identityText}>
          <div className={styles.marketLine}>
            <span className={styles.market}>{position.market}</span>
            {' '}
            <span className={`${styles.side} ${position.side === 'long' ? styles.long : styles.short}`}>{sideLabel}</span>
          </div>
          <p className={styles.positionMeta}>Position #{position.info.positionId}<span aria-hidden="true">·</span><strong>{leverage}</strong> {leverageInfo.label}</p>
        </div>
        {interactive && <span className={styles.navigateIcon} aria-hidden="true"><ChevronRight /></span>}
      </div>
      <div className={styles.positionValue} title={positionValueTitle}>
        <div className={styles.positionValueLabel}>
          <span>Position value</span>
          <span className={styles.valueBasis}>Collateral − debt</span>
        </div>
        <span className={styles.positionValueNumber}>{netEquity}</span>
      </div>
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Collateral</span>
          <p className={styles.metricValue}>{collateral} {position.info.rawCollsToken}</p>
          <p className={styles.metricDetail}>{collateralUsd}</p>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Debt</span>
          <p className={styles.metricValue}>{debt} {position.info.rawDebtsToken}</p>
          <p className={styles.metricDetail}>{debtUsd}</p>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Market price</span>
          <p className={styles.metricValue}>{marketPriceDisplay}</p>
        </div>
        <div className={styles.metric} title="Debt value divided by collateral value">
          <span className={styles.metricLabel}>Debt / collateral</span>
          <p className={styles.metricValue}>{debtCollateralDisplay}</p>
        </div>
      </div>
    </div>
  );
}

export function ProtocolPositionCard({
  position,
  compact = false,
  highlighted = false,
  selected = false,
  href,
  onSelect,
  onNavigate,
  className = '',
}: {
  position: UiPosition;
  compact?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  href?: string;
  onSelect?: () => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const classes = `${styles.card} ${compact ? styles.compact : ''} ${href || onSelect ? styles.interactive : ''} ${selected ? styles.selected : ''} ${highlighted ? styles.highlighted : ''} ${className}`;
  const body = <PositionBody position={position} compact={compact} interactive={Boolean(href || onSelect)} />;

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
  const label = status === 'partial' && hasPositions
    ? `Refreshing ${groups || 'position details'}`
    : hasPositions
      ? `Could not refresh ${groups || 'positions'}; showing last verified details`
      : 'Positions are temporarily unavailable';

  return (
    <div role="status" aria-label={label} className={`flex items-center gap-2.5 rounded-xl border border-[rgba(255,194,102,.2)] bg-[rgba(255,194,102,.08)] text-warn ${compact ? 'p-2.5' : 'p-3'}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-[11px] leading-relaxed">{refreshing ? 'Refreshing positions' : 'Refresh positions'}</span>
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
