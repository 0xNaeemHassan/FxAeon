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

export type TradeDeepLinkContext = {
  market: 'ETH' | 'BTC';
  side: 'long' | 'short';
  asset?: string;
};

/** Read only explicit Trade context so wallet hydration cannot erase a link. */
export function readTradeDeepLinkContext(search: string): TradeDeepLinkContext | null {
  const params = new URLSearchParams(search);
  if (!params.has('market') && !params.has('side') && !params.has('asset')) return null;
  return {
    market: params.get('market') === 'BTC' ? 'BTC' : 'ETH',
    side: params.get('side') === 'short' ? 'short' : 'long',
    asset: params.get('asset') ?? undefined,
  };
}
