import { compareExactDecimals, decimalInputError } from '@/lib/amount';

/** A balance as the forms hold it; only a settled balance can block an amount. */
export type BlockerBalance = { status: string; amount?: string | null } | null | undefined;

/**
 * The one thing an amount still needs, worded for the primary action that
 * shows it: an empty wallet, nothing typed, an invalid figure, or more than
 * the wallet holds. Null means the amount can go to review.
 */
export function amountBlocker(
  amount: string,
  decimals: number,
  symbol: string,
  balance?: BlockerBalance,
  options: { emptyLabel?: string; allowAll?: boolean } = {},
): string | null {
  const settled = balance?.status === 'ready' && typeof balance.amount === 'string' ? balance.amount : null;
  if (settled !== null && !/[1-9]/.test(settled)) return options.emptyLabel ?? `No ${symbol} available`;
  const value = amount.trim();
  if (!value) return 'Enter an amount';
  if (options.allowAll && value.toLowerCase() === 'all') return null;
  if (decimalInputError(value, decimals)) return 'Enter a valid amount';
  if (settled !== null && compareExactDecimals(value, settled, decimals) === 1) return `Insufficient ${symbol}`;
  return null;
}
