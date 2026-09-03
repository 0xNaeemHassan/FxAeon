import { formatUnits } from 'viem';
import type { WalletBalancesResult } from '../lib/fx/balances';
import { priceKeyForSymbol, type UsdPriceMap } from '../lib/prices';
import { usdCentsForDecimalAmount } from '../lib/positionValuation';

export type WalletBalanceReader = (walletAddress: string) => Promise<WalletBalancesResult>;

export type CachedWalletBalanceReader = {
  read: (walletAddress: string, force?: boolean) => Promise<WalletBalancesResult>;
  isPending: (walletAddress: string) => boolean;
  clear: (walletAddress?: string) => void;
};

type CacheEntry = {
  timestamp: number;
  generation: number;
  result?: WalletBalancesResult;
  promise?: Promise<WalletBalancesResult>;
};

/** Deduplicate reads while keeping balances fresh for active dapp surfaces. */
export function createWalletBalanceReader(
  readWalletBalances: WalletBalanceReader,
  now: () => number = Date.now,
  ttlMs = 15_000,
): CachedWalletBalanceReader {
  const cache = new Map<string, CacheEntry>();
  let generation = 0;

  const read = (walletAddress: string, force = false): Promise<WalletBalancesResult> => {
    const cacheKey = walletAddress.toLowerCase();
    const cached = cache.get(cacheKey);
    if (!force) {
      if (cached?.promise) return cached.promise;
      if (cached?.result && now() - cached.timestamp < ttlMs) return Promise.resolve(cached.result);
    }
    const entryGeneration = ++generation;
    const promise = readWalletBalances(walletAddress).then((result) => {
      if (cache.get(cacheKey)?.generation === entryGeneration) {
        cache.set(cacheKey, { timestamp: now(), generation: entryGeneration, result });
      }
      return result;
    }).catch((error) => {
      if (cache.get(cacheKey)?.generation === entryGeneration) cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, { timestamp: now(), generation: entryGeneration, promise });
    return promise;
  };

  return {
    read,
    isPending: (walletAddress) => Boolean(cache.get(walletAddress.toLowerCase())?.promise),
    clear: (walletAddress) => {
      if (walletAddress) cache.delete(walletAddress.toLowerCase());
      else cache.clear();
    },
  };
}

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
