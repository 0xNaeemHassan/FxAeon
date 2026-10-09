'use client';

import { useUsdPrices } from '@/components/PriceProvider';
import { MissingValue } from '@/components/MissingValue';
import { freshDisplayPrices } from '@/lib/displayPrices';
import { positionCollateralTokenAddress } from '@/lib/fx/policy';
import { positionOutcomeFacts } from '@/lib/fx/reviewFormatting';
import { FX_TOKENS, type FxTokenKey } from '@/lib/fx/tokens';
import type { PlannedRoute } from '@/lib/fx/types';
import { approximately, collateralUsdEstimate } from '@/lib/tradeOutcome';
import styles from './TradeOutcomePreview.module.css';

/** The token a new position's collateral is quoted in, so the placeholder can reserve its USD line. */
function collateralKey(market: 'ETH' | 'BTC', side: 'long' | 'short'): FxTokenKey | undefined {
  const address = positionCollateralTokenAddress(market, side).toLowerCase();
  return (Object.keys(FX_TOKENS) as FxTokenKey[]).find((key) => FX_TOKENS[key].address.toLowerCase() === address);
}

type Row = { label: string; value?: string; title?: string; usd?: string | null; reserveUsd?: boolean };

/**
 * What the ticket's warmed route would hold once it executes, under the
 * leverage field: the position's collateral (with a USD value while a fresh
 * price exists), the debt it takes, and the protocol fee. These are the
 * review's own facts for that route, with the review's labels, units and
 * rounding, each marked as an estimate; the review still plans, simulates and
 * validates the route before anything is signed. `route` is null while the
 * warm-up runs: the same rows hold their place with placeholders.
 */
export function TradeOutcomePreview({ market, side, route }: { market: 'ETH' | 'BTC'; side: 'long' | 'short'; route: PlannedRoute | null }) {
  const prices = freshDisplayPrices(useUsdPrices());
  const facts = route ? positionOutcomeFacts(route) : null;
  // A route the review cannot describe either has nothing to preview.
  if (route && !facts) return null;
  const expectedKey = collateralKey(market, side);
  const rows: Row[] = facts ? [
    { label: facts.collateral.label, value: approximately(facts.collateral.value), title: facts.collateral.title, usd: collateralUsdEstimate(facts.collateral, prices) },
    { label: facts.debt.label, value: approximately(facts.debt.value), title: facts.debt.title },
    // The rate is the pool's own quoted rate, shown exactly as the review shows it.
    { label: facts.fee?.label ?? 'Protocol fee rate', value: facts.fee?.value ?? 'Unavailable', title: facts.fee?.title },
  ] : [
    { label: 'Estimated collateral', reserveUsd: expectedKey !== undefined && prices[expectedKey] !== undefined },
    { label: 'Estimated debt' },
    { label: 'Protocol fee rate' },
  ];
  return (
    <div className={styles.outcome} role="group" aria-label="Estimated position" aria-busy={!facts || undefined} data-trade-outcome={facts ? 'ready' : 'pending'}>
      <dl className={styles.facts}>
        {rows.map((row) => <div key={row.label} className={styles.row} data-outcome-fact={row.label}>
          <dt>{row.label}</dt>
          <dd>
            {row.value === undefined
              ? <MissingValue width={row.label === 'Protocol fee rate' ? 'sm' : 'xl'} announce={false} label={`Loading ${row.label.toLowerCase()}`} />
              : <span className={styles.figure} title={row.title}>{row.value}</span>}
            {row.usd && <span className={`${styles.usd} ${styles.figure}`}>{row.usd}</span>}
            {row.reserveUsd && <span className={styles.usd}><MissingValue width="lg" announce={false} label="Loading USD value" /></span>}
          </dd>
        </div>)}
      </dl>
    </div>
  );
}
