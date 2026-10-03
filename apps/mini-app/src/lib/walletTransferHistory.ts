import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { canonicalAsset, type WalletAssetChain } from './walletAssets';
import { configuredRpcUrls } from './fx/config';
import { canonicalMoveSourceTokenAddress } from './moveBalances';
import { FX_TOKENS } from './fx/tokens';

export type WalletTransferChain = WalletAssetChain;
export type WalletTransferDirection = 'sent' | 'received';
export type WalletTransferCursorMap = Partial<Record<WalletTransferChain, Partial<Record<WalletTransferDirection, string>>>>;

export type WalletTransfer = {
  chainId: WalletTransferChain;
  hash: Hex;
  timestamp: number;
  from: Address;
  to: Address;
  amountRaw: bigint;
  symbol: string;
  decimals: number;
  tokenAddress: Address | null;
  id: string;
};

export type WalletTransferHistoryResult = {
  items: WalletTransfer[];
  partial: boolean;
  cursors: Record<WalletTransferChain, Record<WalletTransferDirection, string | null>>;
};

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;
export type WalletTransferHistoryDependencies = {
  fetcher?: FetchLike;
  getRpcUrls?: (chainId: WalletTransferChain) => string[];
  timeoutMs?: number;
};

const CHAINS = [1, 8453] as const;
const DIRECTIONS = ['sent', 'received'] as const;
const DEFAULT_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_CURSOR_LENGTH = 256;
const MAX_COUNT = '0x14';
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const QUANTITY_PATTERN = /^0x[0-9a-f]{1,64}$/i;

type CacheEntry = { expiresAt: number; result: WalletTransferHistoryResult };
const resultCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WalletTransferHistoryResult>>();

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function emptyCursors(): WalletTransferHistoryResult['cursors'] {
  return { 1: { sent: null, received: null }, 8453: { sent: null, received: null } };
}

function normalizeCursor(cursor: unknown): string | undefined {
  if (typeof cursor !== 'string') return undefined;
  const value = cursor.trim();
  return value && value.length <= MAX_CURSOR_LENGTH ? value : undefined;
}

function normalizedCursors(cursors?: WalletTransferCursorMap): WalletTransferCursorMap {
  const result: WalletTransferCursorMap = {};
  for (const chainId of CHAINS) {
    const chainCursor: Partial<Record<WalletTransferDirection, string>> = {};
    for (const direction of DIRECTIONS) {
      const cursor = normalizeCursor(cursors?.[chainId]?.[direction]);
      if (cursor) chainCursor[direction] = cursor;
    }
    if (Object.keys(chainCursor).length) result[chainId] = chainCursor;
  }
  return result;
}

function cacheKey(address: string, cursors: WalletTransferCursorMap): string {
  return `${address.toLowerCase()}:${JSON.stringify(cursors)}`;
}

function alchemyUrls(chainId: WalletTransferChain, urls: readonly string[]): string[] {
  const host = chainId === 1 ? 'eth-mainnet.g.alchemy.com' : 'base-mainnet.g.alchemy.com';
  return [...new Set(urls.flatMap((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password
        || url.search || url.hash || !/^\/v2\/[^/]+\/?$/.test(url.pathname)) return [];
      return [url.toString()];
    } catch {
      return [];
    }
  }))];
}

function tokenContracts(chainId: WalletTransferChain): Address[] {
  if (chainId === 1) {
    return Object.values(FX_TOKENS).filter((token) => !token.native).map((token) => token.address as Address);
  }
  return [
    canonicalMoveSourceTokenAddress('fxUSD', 8453),
    canonicalMoveSourceTokenAddress('fxSAVE', 8453),
  ];
}

function requestParams(address: Address, chainId: WalletTransferChain, direction: WalletTransferDirection, cursor?: string) {
  return {
    ...(direction === 'sent' ? { fromAddress: address } : { toAddress: address }),
    category: ['external', 'internal', 'erc20'],
    contractAddresses: tokenContracts(chainId),
    excludeZeroValue: true,
    maxCount: MAX_COUNT,
    order: 'desc',
    withMetadata: true,
    ...(cursor ? { pageKey: cursor } : {}),
  };
}

async function timedFetch(fetcher: FetchLike, endpoint: string, body: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error('Transfer history endpoint failed');
        return response.json();
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Transfer history request timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function rpcRequest(
  fetcher: FetchLike,
  endpoints: readonly string[],
  params: ReturnType<typeof requestParams>,
  timeoutMs: number,
): Promise<unknown> {
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const response = record(await timedFetch(fetcher, endpoint, JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [params],
      }), timeoutMs));
      if (!response || response.error) throw new Error('Transfer history response was invalid');
      const result = record(response.result);
      if (!result || !Array.isArray(result.transfers)) throw new Error('Transfer history result was invalid');
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('No Alchemy transfer endpoint is configured');
}

function parseTransfer(
  rawValue: unknown,
  chainId: WalletTransferChain,
  wallet: Address,
  direction: WalletTransferDirection,
  index: number,
): { transfer?: WalletTransfer; malformed: boolean } {
  const raw = record(rawValue);
  const contract = record(raw?.rawContract);
  const metadata = record(raw?.metadata);
  const hash = raw?.hash;
  const fromValue = raw?.from;
  const toValue = raw?.to;
  const category = raw?.category;
  const rawAmount = contract?.value;
  const timestampValue = metadata?.blockTimestamp;
  if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)
    || typeof fromValue !== 'string' || !isAddress(fromValue)
    || typeof toValue !== 'string' || !isAddress(toValue)
    || typeof timestampValue !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(timestampValue)
    || !contract || typeof rawAmount !== 'string' || !QUANTITY_PATTERN.test(rawAmount)
    || (category !== 'external' && category !== 'internal' && category !== 'erc20')) {
    return { malformed: true };
  }
  const from = getAddress(fromValue);
  const to = getAddress(toValue);
  const isWalletDirection = direction === 'sent'
    ? from.toLowerCase() === wallet.toLowerCase()
    : to.toLowerCase() === wallet.toLowerCase();
  if (!isWalletDirection) return { malformed: true };

  const rawContractAddress = contract.address;
  let tokenAddress: Address | null;
  if (rawContractAddress === null) {
    if (category === 'erc20') return { malformed: true };
    tokenAddress = null;
  } else if (typeof rawContractAddress === 'string' && isAddress(rawContractAddress)) {
    tokenAddress = getAddress(rawContractAddress);
  } else {
    return { malformed: true };
  }
  const canonical = canonicalAsset(chainId, tokenAddress);
  if (!canonical) return { malformed: false };

  const timestamp = Date.parse(timestampValue);
  if (!Number.isFinite(timestamp) || timestamp < 0) return { malformed: true };
  const amountRaw = BigInt(rawAmount);
  if (amountRaw === 0n) return { malformed: false };
  const uniqueId = typeof raw?.uniqueId === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(raw.uniqueId)
    ? raw.uniqueId
    : String(index);
  const id = `${chainId}:${hash.toLowerCase()}:${from.toLowerCase()}:${to.toLowerCase()}:${tokenAddress?.toLowerCase() ?? 'native'}:${amountRaw}:${uniqueId}`;
  return {
    malformed: false,
    transfer: {
      chainId,
      hash: hash as Hex,
      timestamp,
      from,
      to,
      amountRaw,
      symbol: canonical.key,
      decimals: canonical.decimals,
      tokenAddress,
      id,
    },
  };
}

async function loadUncached(
  address: Address,
  cursors: WalletTransferCursorMap,
  dependencies: WalletTransferHistoryDependencies,
): Promise<WalletTransferHistoryResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const getRpcUrls = dependencies.getRpcUrls ?? configuredRpcUrls;
  const endpoints: Record<WalletTransferChain, string[]> = { 1: [], 8453: [] };
  for (const chainId of CHAINS) {
    try {
      endpoints[chainId] = alchemyUrls(chainId, getRpcUrls(chainId));
    } catch {
      endpoints[chainId] = [];
    }
  }

  const result: WalletTransferHistoryResult = { items: [], partial: false, cursors: emptyCursors() };
  const seen = new Set<string>();
  const requests = CHAINS.flatMap((chainId) => DIRECTIONS.map(async (direction) => {
    const requestCursor = cursors[chainId]?.[direction];
    // A pagination request must not restart directions that already reached the end.
    if (Object.keys(cursors).length > 0 && !requestCursor) return;
    const priorCursor = normalizeCursor(requestCursor) ?? null;
    if (endpoints[chainId].length === 0) {
      result.partial = true;
      result.cursors[chainId][direction] = priorCursor;
      return;
    }
    try {
      const response = record(await rpcRequest(fetcher, endpoints[chainId], requestParams(address, chainId, direction, requestCursor), timeoutMs));
      const rawNextCursor = response?.pageKey;
      const nextCursor = normalizeCursor(rawNextCursor);
      if (rawNextCursor !== undefined && rawNextCursor !== '' && !nextCursor) result.partial = true;
      result.cursors[chainId][direction] = nextCursor ?? null;
      const transfers = response?.transfers;
      if (!Array.isArray(transfers)) { result.partial = true; return; }
      transfers.forEach((item, index) => {
        const parsed = parseTransfer(item, chainId, address, direction, index);
        if (parsed.malformed) result.partial = true;
        if (parsed.transfer && !seen.has(parsed.transfer.id)) {
          seen.add(parsed.transfer.id);
          result.items.push(parsed.transfer);
        }
      });
    } catch {
      result.partial = true;
      result.cursors[chainId][direction] = priorCursor;
    }
  }));
  await Promise.all(requests);
  result.items.sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id));
  return result;
}

/** Load one bounded page per direction on Ethereum and Base. Cursors are used
 * only when explicitly passed; this function never follows a pageKey itself. */
export function loadWalletTransferHistory(
  walletAddress: string,
  cursorsInput?: WalletTransferCursorMap,
  dependencies: WalletTransferHistoryDependencies = {},
): Promise<WalletTransferHistoryResult> {
  const addressValid = isAddress(walletAddress);
  if (!addressValid) return Promise.resolve({ items: [], partial: true, cursors: emptyCursors() });
  const address = getAddress(walletAddress);
  const cursors = normalizedCursors(cursorsInput);
  const hasOverrides = Boolean(dependencies.fetcher || dependencies.getRpcUrls || dependencies.timeoutMs !== undefined);
  if (hasOverrides) return loadUncached(address, cursors, dependencies);

  const key = cacheKey(address, cursors);
  const now = Date.now();
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.result);
  if (cached) resultCache.delete(key);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = loadUncached(address, cursors, dependencies).then((result) => {
    if (!result.partial) {
      if (resultCache.size >= MAX_CACHE_ENTRIES) resultCache.delete(resultCache.keys().next().value as string);
      resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    }
    return result;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
