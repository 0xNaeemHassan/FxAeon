import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { configuredAlchemyUrls, timedFetch, type WalletTransferChain } from './walletTransferHistory';

/** The parts of a mined transaction History uses to name an action. Display only. */
export type ActivityCall = { from: Address; to: Address | null; input: Hex; value: bigint };
export type ActivityCallRequest = { chainId: WalletTransferChain; hash: string };
export type ActivityCallDependencies = {
  fetcher?: typeof fetch;
  getRpcUrls?: (chainId: WalletTransferChain) => string[];
  timeoutMs?: number;
};

const TIMEOUT_MS = 6_000;
/** One JSON-RPC batch per chain; anything beyond this waits for the next round. */
const MAX_BATCH = 200;
const MAX_CACHE_ENTRIES = 1_000;
const MAX_INPUT_LENGTH = 2 + 1_048_576;
const HASH = /^0x[0-9a-f]{64}$/i;
const QUANTITY = /^0x[0-9a-f]{1,64}$/i;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/i;

// Mined calldata never changes, so a hash is cached for the page's lifetime.
// `null` records a transaction the node does not know; failures are not cached.
const cache = new Map<string, ActivityCall | null>();

export const activityCallKey = (chainId: number, hash: string) => `${chainId}:${hash.toLowerCase()}`;

export function cachedActivityCall(chainId: number, hash: string): ActivityCall | null | undefined {
  return cache.get(activityCallKey(chainId, hash));
}

/** Cached calldata by `activityCallKey`; undefined while it has not been read. */
export function cachedActivityCallByKey(key: string): ActivityCall | null | undefined {
  return cache.get(key);
}

/** Requests whose calldata is not cached yet, deduplicated and capped per chain. */
export function uncachedActivityCalls(requests: readonly ActivityCallRequest[]): ActivityCallRequest[] {
  const seen = new Set<string>();
  const perChain: Record<WalletTransferChain, number> = { 1: 0, 8453: 0 };
  return requests.filter((request) => {
    const key = activityCallKey(request.chainId, request.hash);
    if (!HASH.test(request.hash) || seen.has(key) || cache.has(key) || perChain[request.chainId] >= MAX_BATCH) return false;
    seen.add(key);
    perChain[request.chainId] += 1;
    return true;
  });
}

function remember(key: string, call: ActivityCall | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, call);
}

function parseTransaction(value: unknown, hash: string): ActivityCall | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const transaction = value as Record<string, unknown>;
  const { from, to, input, value: amount } = transaction;
  if (typeof transaction.hash !== 'string' || transaction.hash.toLowerCase() !== hash.toLowerCase()
    || typeof from !== 'string' || !isAddress(from)
    || (to !== null && (typeof to !== 'string' || !isAddress(to)))
    || typeof input !== 'string' || input.length > MAX_INPUT_LENGTH || !HEX_DATA.test(input)
    || typeof amount !== 'string' || !QUANTITY.test(amount)) return undefined;
  return { from: getAddress(from), to: to === null ? null : getAddress(to), input: input as Hex, value: BigInt(amount) };
}

async function loadChain(chainId: WalletTransferChain, hashes: readonly string[], dependencies: ActivityCallDependencies): Promise<boolean> {
  const endpoints = configuredAlchemyUrls(chainId, dependencies.getRpcUrls);
  if (!endpoints.length) return false;
  const body = JSON.stringify(hashes.map((hash, id) => ({ jsonrpc: '2.0', id, method: 'eth_getTransactionByHash', params: [hash] })));
  const timeoutMs = Math.min(TIMEOUT_MS, Math.max(1, dependencies.timeoutMs ?? TIMEOUT_MS));
  for (const endpoint of endpoints) {
    try {
      const response = await timedFetch(dependencies.fetcher ?? fetch, endpoint, body, timeoutMs);
      if (!Array.isArray(response)) continue;
      let complete = response.length === hashes.length;
      for (const item of response) {
        const entry = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
        const id = entry?.id;
        if (!entry || typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= hashes.length || entry.error || !('result' in entry)) {
          complete = false;
          continue;
        }
        const call = parseTransaction(entry.result, hashes[id]);
        if (call === undefined) complete = false;
        else remember(activityCallKey(chainId, hashes[id]), call);
      }
      return complete;
    } catch {
      // Try the next configured Alchemy endpoint.
    }
  }
  return false;
}

/**
 * Read calldata for transactions History found without a journal record: one
 * `eth_getTransactionByHash` batch per chain, Alchemy endpoints only, 6s
 * deadline. Failures leave those rows unclassified; they never throw.
 */
export async function loadActivityCalls(requests: readonly ActivityCallRequest[], dependencies: ActivityCallDependencies = {}): Promise<{ partial: boolean }> {
  const pending = uncachedActivityCalls(requests);
  const results = await Promise.all(([1, 8453] as const).map((chainId) => {
    const hashes = pending.filter((request) => request.chainId === chainId).map((request) => request.hash);
    return hashes.length ? loadChain(chainId, hashes, dependencies) : Promise.resolve(true);
  }));
  return { partial: results.some((complete) => !complete) };
}

export function clearActivityCallsForTests(): void {
  cache.clear();
}
