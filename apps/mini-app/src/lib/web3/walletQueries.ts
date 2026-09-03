import { QueryClient, queryOptions } from '@tanstack/react-query';
import { getBalance, readContracts } from 'wagmi/actions';
import { hashFn } from 'wagmi/query';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { getChainId } from 'viem/actions';
import { FX_TOKENS, type FxTokenKey } from '../fx/tokens';
import { assertWalletAddress } from '../fx/validation';
import type { WalletBalancesResult } from '../fx/balances';
import type { WalletDataConfig } from './config';
import { CANONICAL_MOVE_ASSETS, canonicalMoveSourceTokenAddress, type CanonicalMoveBalanceMap } from '../moveBalances';

export const WALLET_QUERY_ROOT = 'fxaeon-wallet';
export const WALLET_BALANCE_STALE_MS = 15_000;

export function createWalletQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: {
      queryKeyHashFn: hashFn,
      staleTime: WALLET_BALANCE_STALE_MS,
      gcTime: 60_000,
      retry: 1,
      retryDelay: 1_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
      // BigInt balances must remain exact; the default JSON structural-sharing
      // walk is unnecessary for this small normalized result.
      structuralSharing: false,
    },
    mutations: { retry: false },
  } });
}

export function walletBalanceQueryKey(session: string, address: string, chainId: number) {
  return [WALLET_QUERY_ROOT, session, chainId, address.toLowerCase(), 'balances'] as const;
}

/** Standard ERC-20 reads only. Protocol state/plans remain with the f(x) SDK. */
export async function readWagmiWalletBalances(
  config: WalletDataConfig, walletAddress: string, chainId: number, signal?: AbortSignal,
): Promise<WalletBalancesResult> {
  const address: Address = assertWalletAddress(walletAddress);
  if (chainId !== 1) throw new Error('Supported token balances are available on Ethereum only.');
  signal?.throwIfAborted();
  // Wagmi's configured chain is metadata, not evidence about the RPC server.
  const remoteChain = await getChainId(config.getClient({ chainId }));
  if (remoteChain !== chainId) throw new Error(`RPC endpoint returned chain ${remoteChain}; expected ${chainId}`);
  signal?.throwIfAborted();
  const tokens = Object.values(FX_TOKENS).filter((token) => !token.native);
  const [native, erc20] = await Promise.allSettled([
    getBalance(config, { address, chainId }),
    readContracts(config, {
      allowFailure: true,
      contracts: tokens.map((token) => ({
        chainId, address: token.address, abi: erc20Abi,
        functionName: 'balanceOf' as const, args: [address] as const,
      })),
    }),
  ]);
  signal?.throwIfAborted();
  const balances: WalletBalancesResult['balances'] = [];
  const failedTokens: FxTokenKey[] = [];
  if (native.status === 'fulfilled') {
    const token = FX_TOKENS.ETH;
    balances.push({ key: token.key, address: token.address, decimals: token.decimals, amountWei: native.value.value });
  } else failedTokens.push('ETH');
  tokens.forEach((token, index) => {
    const result = erc20.status === 'fulfilled' ? erc20.value[index] : undefined;
    if (result?.status === 'success' && typeof result.result === 'bigint' && result.result >= 0n) {
      balances.push({ key: token.key, address: token.address, decimals: token.decimals, amountWei: result.result });
    } else failedTokens.push(token.key);
  });
  if (!balances.length) throw new Error('Wallet balances are temporarily unavailable.');
  return { balances, failedTokens };
}

export function walletBalanceQueryOptions(config: WalletDataConfig, session: string, address: string, chainId = 1) {
  return queryOptions({
    queryKey: walletBalanceQueryKey(session, address, chainId),
    queryFn: ({ signal }) => readWagmiWalletBalances(config, address, chainId, signal),
  });
}

export function walletQueryScope(address: string, chainId: number) {
  return {
    predicate: ({ queryKey }) => queryKey[0] === WALLET_QUERY_ROOT
      && queryKey[2] === chainId && queryKey[3] === address.toLowerCase(),
  } satisfies Parameters<QueryClient['invalidateQueries']>[0];
}

type RefreshWork = { generation: number; promise: Promise<void> };
const refreshes = new WeakMap<QueryClient, Map<string, RefreshWork>>();

/**
 * A pre-receipt RPC response must not win a post-receipt refresh. Cancel it,
 * then refetch; coalesce simultaneous consumers of the same wallet/chain.
 */
export function invalidateWalletQueries(client: QueryClient, address: string, chainId: number): Promise<void> {
  let pending = refreshes.get(client);
  if (!pending) { pending = new Map(); refreshes.set(client, pending); }
  const key = `${address.toLowerCase()}:${chainId}`;
  const existing = pending.get(key);
  if (existing) {
    // A later receipt may arrive while a manual refresh is already reading.
    // Joining it alone would accept a pre-receipt value. Mark a trailing read
    // and resolve every caller only once the newest generation is covered.
    existing.generation += 1;
    return existing.promise;
  }
  const scope = walletQueryScope(address, chainId);
  const work: RefreshWork = { generation: 0, promise: Promise.resolve() };
  work.promise = Promise.resolve().then(async () => {
    let covered: number;
    do {
      covered = work.generation;
      await client.cancelQueries(scope);
      await client.invalidateQueries({ ...scope, refetchType: 'active' });
    } while (covered !== work.generation);
  }).finally(() => { pending.delete(key); });
  pending.set(key, work);
  return work.promise;
}

export function moveBalanceQueryOptions(config: WalletDataConfig, session: string, address: string, chainId: number) {
  return queryOptions({
    queryKey: [WALLET_QUERY_ROOT, session, chainId, address.toLowerCase(), 'move-balances'] as const,
    queryFn: async ({ signal }): Promise<{ balances: CanonicalMoveBalanceMap; status: 'ready' | 'unavailable' }> => {
      const owner = assertWalletAddress(address);
      if (chainId !== 1 && chainId !== 8453) throw new Error('Unsupported bridge chain.');
      signal.throwIfAborted();
      if (await getChainId(config.getClient({ chainId })) !== chainId) throw new Error('RPC network does not match the selected source.');
      signal.throwIfAborted();
      const results = await readContracts(config, { allowFailure: true, contracts: CANONICAL_MOVE_ASSETS.map((token) => ({
        chainId, address: canonicalMoveSourceTokenAddress(token, chainId),
        abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const,
      })) });
      signal.throwIfAborted();
      let successful = 0;
      const balances = Object.fromEntries(CANONICAL_MOVE_ASSETS.map((token, index) => {
        const result = results[index];
        if (result?.status === 'success' && typeof result.result === 'bigint' && result.result >= 0n) {
          successful += 1;
          return [token, { status: 'ready', amount: formatUnits(result.result, 18) }];
        }
        return [token, { status: 'unavailable', reason: 'This source balance could not be read.' }];
      })) as CanonicalMoveBalanceMap;
      return { balances, status: successful ? 'ready' : 'unavailable' };
    },
  });
}
