import type { ReviewFact } from '@/lib/fx/reviewFormatting';

const ALWAYS_VISIBLE = new Set([
  'Amount', 'Deposit', 'Borrow', 'Repay', 'Withdraw', 'fxSAVE', 'Receive', 'Asset',
  'Action', 'Position', 'Mode', 'Slippage', 'Minimum received', 'Quoted minimum received',
  'Minimum fxSAVE received', 'Minimum converted input', 'Minimum converted deposit',
  'Minimum debt repaid', 'Minimum received (fxUSD leg)', 'Minimum received (USDC leg)',
  'Gas fee', 'Protocol fee', 'Total cost', 'Bridge fee', 'Risk',
]);

/** Separate concise decision facts from exact quote and route metadata. */
export function splitReviewFacts(facts: readonly ReviewFact[]): {
  summary: ReviewFact[];
  details: ReviewFact[];
} {
  const hasTargetLeverage = facts.some((fact) => fact.label === 'Target leverage');
  const summary: ReviewFact[] = [];
  const details: ReviewFact[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    if (fact.label === 'Leverage' && hasTargetLeverage) {
      details.push({ ...fact, label: 'Quoted leverage' });
      continue;
    }
    const identity = fact.label === 'Risk' ? 'Risk' : `${fact.label}:${fact.value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    (ALWAYS_VISIBLE.has(fact.label) || fact.label === 'Target leverage' ? summary : details).push(fact);
  }
  return { summary, details };
}
