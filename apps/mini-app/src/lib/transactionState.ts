/**
 * Conservative defaults used whenever a transaction's identity changes.
 * Keeping these in one module makes it harder for a new context switch to
 * accidentally retain a value that was entered for another route.
 */
export const SAFE_DEFAULT_LEVERAGE = 2;
export const SAFE_DEFAULT_FRACTION = 25;

export function resetTransactionAmounts(): {
  amount: string;
  deposit: string;
  mint: string;
  repay: string;
  withdraw: string;
  shares: string;
  fraction: number;
  leverage: number;
} {
  return {
    amount: '',
    deposit: '',
    mint: '',
    repay: '',
    withdraw: '',
    shares: '',
    fraction: SAFE_DEFAULT_FRACTION,
    leverage: SAFE_DEFAULT_LEVERAGE,
  };
}
