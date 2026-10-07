import type { ReviewFact } from '@/lib/fx/reviewFormatting';

const ROWS = ['Amount', 'Target leverage', 'Position', 'Slippage', 'Estimated collateral', 'Estimated debt', 'Protocol fee rate', 'Minimum converted input', 'Gas fee', 'Total cost'] as const;
const ENTERED = new Set(['Amount', 'Target leverage', 'Position', 'Slippage']);

/** Presentation only: reserve unknown values without manufacturing a route. */
export function stableTradeReviewFacts(
  entered: readonly ReviewFact[],
  verified: readonly ReviewFact[],
  state: { preparing: boolean; failed: boolean; checkingGas: boolean; totalIsGasOnly?: boolean; hasVerifiedRoute?: boolean },
): ReviewFact[] {
  const inputs = new Map(entered.map((fact) => [fact.label, fact]));
  const quotes = new Map(verified.map((fact) => [fact.label, fact]));
  const rows = ROWS.map((label) => {
    const input = ENTERED.has(label) ? inputs.get(label) : undefined;
    if (input) return input;
    const pending = !state.failed && (state.preparing || (state.checkingGas && (label === 'Gas fee' || label === 'Total cost')));
    if (pending) return { label, value: '—' };
    if (label === 'Total cost' && !quotes.has(label) && state.totalIsGasOnly) return { label, value: 'Included in gas fee' };
    if (label === 'Minimum converted input' && !quotes.has(label) && state.hasVerifiedRoute) return { label, value: 'Not quoted' };
    return quotes.get(label) ?? { label, value: 'Unavailable' };
  });
  return [...rows, ...verified.filter((fact) => !ROWS.some((label) => label === fact.label))];
}
