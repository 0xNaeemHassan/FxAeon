import { formatUnits } from 'viem';
import type { WalletBalancesResult } from '../lib/fx/balances';
import { priceKeyForSymbol, type UsdPriceMap } from '../lib/prices';
import { usdCentsForDecimalAmount } from '../lib/positionValuation';

// Display mapping only. WalletDataProvider owns the shared query cache.
export type TokenBalanceView = {
  status: 'loading' | 'ready' | 'unavailable' | 'disconnected';
  amount?: string;
  reason?: string;
};

export type TokenBalanceMap = Readonly<Record<string, TokenBalanceView>>;

export function balanceMapForResult(result: WalletBalancesResult): TokenBalanceMap {
  const byKey: Record<string, TokenBalanceView> = {};
  result.balances.forEach((balance) => {
    byKey[balance.key] = { status: 'ready', amount: formatUnits(balance.amountWei, balance.decimals) };
  });
  result.failedTokens.forEach((key) => {
    byKey[key] = { status: 'unavailable', reason: 'This token balance could not be read.' };
  });
  return byKey;
}

export function tokenBalanceFor(balances: TokenBalanceMap, token: string): TokenBalanceView | undefined {
  if (balances[token]) return balances[token];
  const entry = Object.entries(balances).find(([key]) => key.toLowerCase() === token.toLowerCase());
  return entry?.[1];
}

/** Display-only valuation: zero is known even when its quote is unavailable. */
export function usdCentsForTokenBalance(balance: TokenBalanceView | undefined, token: string, prices: UsdPriceMap): bigint | null {
  if (!balance || balance.status !== 'ready' || balance.amount === undefined) return null;
  const key = priceKeyForSymbol(token);
  return usdCentsForDecimalAmount(balance.amount, key ? prices[key] : undefined);
}
