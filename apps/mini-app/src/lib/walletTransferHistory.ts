import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { canonicalAsset, type WalletAssetChain } from './walletAssets';
import { configuredRpcUrls } from './fx/config';
import { positionPoolAddress } from './fx/policy';
import { compactAddress } from './addressPresentation';

export type WalletTransferChain = WalletAssetChain;
export type WalletTransferDirection = 'sent' | 'received';
/** Fungible transfers in each direction, plus f(x) position NFT movements on Ethereum. */
export type WalletTransferStream = WalletTransferDirection | 'positionsSent' | 'positionsReceived';
export type WalletTransferCursorMap = Partial<Record<WalletTransferChain, Partial<Record<WalletTransferStream, string>>>>;

export type WalletTransfer = {
  chainId: WalletTransferChain;
  hash: Hex;
  timestamp: number;
  from: Address;
  to: Address;
  amountRaw: bigint;
  /** Canonical symbol, or the indexer's sanitized symbol for an unverified token. */
  symbol: string;
  /** Canonical decimals, or the indexer's; null when an unverified token's are unknown. */
  decimals: number | null;
  tokenAddress: Address | null;
  /** A canonical FxAeon asset. Unverified tokens are never priced or shown without a marker. */
  verified: boolean;
  id: string;
};

/** A position NFT moving between the wallet and someone else; classification evidence only. */
export type WalletPositionTransfer = {
  chainId: 1;
  hash: Hex;
  timestamp: number;
  from: Address;
  to: Address;
  pool: Address;
  tokenId: bigint;
  id: string;
};

export type WalletTransferHistoryResult = {
  items: WalletTransfer[];
  positionTransfers: WalletPositionTransfer[];
  partial: boolean;
  cursors: Record<WalletTransferChain, Record<WalletTransferStream, string | null>>;
};

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;
export type WalletTransferHistoryDependencies = {
  fetcher?: FetchLike;
  getRpcUrls?: (chainId: WalletTransferChain) => string[];
  timeoutMs?: number;
};

const CHAINS = [1, 8453] as const;
const STREAMS = ['sent', 'received', 'positionsSent', 'positionsReceived'] as const;
const CHAIN_STREAMS: Record<WalletTransferChain, readonly WalletTransferStream[]> = {
  1: STREAMS,
  // The f(x) position pools exist only on Ethereum.
  8453: ['sent', 'received'],
};
/** Pages per stream on a first load; "Load more" then reads one page per stream. */
const FIRST_LOAD_PAGES = 2;
const DEFAULT_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_CURSOR_LENGTH = 256;
const MAX_COUNT = '0x14';
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const QUANTITY_PATTERN = /^0x[0-9a-f]{1,64}$/i;
const POSITION_POOLS = (['ETH', 'BTC'] as const).flatMap((market) => (['long', 'short'] as const).map((side) => positionPoolAddress(market, side)));
const POSITION_POOL_SET = new Set(POSITION_POOLS.map((pool) => pool.toLowerCase()));
const MAX_SYMBOL_LENGTH = 16;
const MAX_TOKEN_DECIMALS = 36;

type CacheEntry = { expiresAt: number; result: WalletTransferHistoryResult };
const resultCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WalletTransferHistoryResult>>();
/** Chains whose indexer rejected the `internal` category; learned once per page load. */
const internalUnsupported = new Set<WalletTransferChain>();

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function emptyCursors(): WalletTransferHistoryResult['cursors'] {
  const empty = () => ({ sent: null, received: null, positionsSent: null, positionsReceived: null });
  return { 1: empty(), 8453: empty() };
}

function normalizeCursor(cursor: unknown): string | undefined {
  if (typeof cursor !== 'string') return undefined;
  const value = cursor.trim();
  return value && value.length <= MAX_CURSOR_LENGTH ? value : undefined;
}

function normalizedCursors(cursors?: WalletTransferCursorMap): WalletTransferCursorMap {
  const result: WalletTransferCursorMap = {};
  for (const chainId of CHAINS) {
    const chainCursor: Partial<Record<WalletTransferStream, string>> = {};
    for (const stream of CHAIN_STREAMS[chainId]) {
      const cursor = normalizeCursor(cursors?.[chainId]?.[stream]);
      if (cursor) chainCursor[stream] = cursor;
    }
    if (Object.keys(chainCursor).length) result[chainId] = chainCursor;
  }
  return result;
}

function cacheKey(address: string, cursors: WalletTransferCursorMap): string {
  return `${address.toLowerCase()}:${JSON.stringify(cursors)}`;
}

/** Only exact Alchemy endpoints: other providers have no transfer index. */
export function alchemyUrls(chainId: WalletTransferChain, urls: readonly string[]): string[] {
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

/** Alchemy endpoints configured for a chain; an unconfigured chain has none. */
export function configuredAlchemyUrls(chainId: WalletTransferChain, getRpcUrls: (chainId: WalletTransferChain) => string[] = configuredRpcUrls): string[] {
  try {
    return alchemyUrls(chainId, getRpcUrls(chainId));
  } catch {
    return [];
  }
}

const isPositionStream = (stream: WalletTransferStream) => stream === 'positionsSent' || stream === 'positionsReceived';
const isSentStream = (stream: WalletTransferStream) => stream === 'sent' || stream === 'positionsSent';

function requestParams(address: Address, chainId: WalletTransferChain, stream: WalletTransferStream, cursor?: string) {
  const positions = isPositionStream(stream);
  return {
    ...(isSentStream(stream) ? { fromAddress: address } : { toAddress: address }),
    // Every ERC-20 is read so nothing the wallet did goes missing; canonical
    // assets are marked verified below. NFTs are limited to the f(x) pools.
    category: positions ? ['erc721'] : internalUnsupported.has(chainId) ? ['external', 'erc20'] : ['external', 'internal', 'erc20'],
    ...(positions ? { contractAddresses: POSITION_POOLS } : {}),
    // Zero-value transfers are address-poisoning spam.
    excludeZeroValue: true,
    maxCount: MAX_COUNT,
    order: 'desc',
    withMetadata: true,
    ...(cursor ? { pageKey: cursor } : {}),
  };
}

/** POST with a hard deadline; rejects on HTTP errors. */
export async function timedFetch(fetcher: FetchLike, endpoint: string, body: string, timeoutMs: number): Promise<unknown> {
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

class UnsupportedInternalCategoryError extends Error {}

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
      const error = record(response?.error);
      // Some networks index no internal (trace) transfers; a generic "internal error" is not that.
      if (error && params.category.includes('internal') && typeof error.message === 'string'
        && /\binternal\b/i.test(error.message) && /categor|not supported|unsupported|only supported|only available/i.test(error.message)) {
        throw new UnsupportedInternalCategoryError(error.message);
      }
      if (!response || response.error) throw new Error('Transfer history response was invalid');
      const result = record(response.result);
      if (!result || !Array.isArray(result.transfers)) throw new Error('Transfer history result was invalid');
      return result;
    } catch (error) {
      if (error instanceof UnsupportedInternalCategoryError) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('No Alchemy transfer endpoint is configured');
}

/** Invisible and direction-changing code points, stripped from indexer text. */
const HIDDEN_CODE_POINTS: readonly (readonly [number, number])[] = [
  [0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff],
];
const isHidden = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return HIDDEN_CODE_POINTS.some(([from, to]) => code >= from && code <= to);
};

/** Indexer symbols are untrusted text: no controls, no direction overrides, bounded length. */
function indexedSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = [...value].filter((char) => !isHidden(char)).join('').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_SYMBOL_LENGTH ? `${cleaned.slice(0, MAX_SYMBOL_LENGTH - 1)}…` : cleaned;
}

function indexedDecimals(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^0x[0-9a-f]{1,2}$/i.test(value) ? Number.parseInt(value, 16)
    : typeof value === 'string' && /^[0-9]{1,2}$/.test(value) ? Number(value)
      : typeof value === 'number' && Number.isInteger(value) ? value : null;
  return parsed !== null && parsed >= 0 && parsed <= MAX_TOKEN_DECIMALS ? parsed : null;
}

type Parsed<T> = { item?: T; malformed: boolean };

function parseCommon(raw: JsonRecord | null, wallet: Address, stream: WalletTransferStream) {
  const metadata = record(raw?.metadata);
  const hash = raw?.hash;
  const fromValue = raw?.from;
  const toValue = raw?.to;
  const timestampValue = metadata?.blockTimestamp;
  if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)
    || typeof fromValue !== 'string' || !isAddress(fromValue)
    || typeof toValue !== 'string' || !isAddress(toValue)
    || typeof timestampValue !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(timestampValue)) return null;
  const from = getAddress(fromValue);
  const to = getAddress(toValue);
  const isWalletDirection = isSentStream(stream)
    ? from.toLowerCase() === wallet.toLowerCase()
    : to.toLowerCase() === wallet.toLowerCase();
  const timestamp = Date.parse(timestampValue);
  if (!isWalletDirection || !Number.isFinite(timestamp) || timestamp < 0) return null;
  const uniqueId = typeof raw?.uniqueId === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(raw.uniqueId) ? raw.uniqueId : null;
  return { hash: hash as Hex, from, to, timestamp, uniqueId };
}

function parseTransfer(
  rawValue: unknown,
  chainId: WalletTransferChain,
  wallet: Address,
  stream: WalletTransferStream,
  index: number,
): Parsed<WalletTransfer> {
  const raw = record(rawValue);
  const contract = record(raw?.rawContract);
  const category = raw?.category;
  const rawAmount = contract?.value;
  const common = parseCommon(raw, wallet, stream);
  if (!common || !contract || typeof rawAmount !== 'string' || !QUANTITY_PATTERN.test(rawAmount)
    || (category !== 'external' && category !== 'internal' && category !== 'erc20')) {
    return { malformed: true };
  }
  const rawContractAddress = contract.address;
  let tokenAddress: Address | null;
  if (rawContractAddress === null) {
    if (category === 'erc20') return { malformed: true };
    tokenAddress = null;
  } else if (category === 'erc20' && typeof rawContractAddress === 'string' && isAddress(rawContractAddress)) {
    tokenAddress = getAddress(rawContractAddress);
  } else {
    // A native ETH transfer never names a token contract.
    return { malformed: true };
  }
  const amountRaw = BigInt(rawAmount);
  if (amountRaw === 0n) return { malformed: false };
  const canonical = canonicalAsset(chainId, tokenAddress);
  const symbol = canonical?.key ?? indexedSymbol(raw?.asset) ?? compactAddress(tokenAddress!);
  const decimals = canonical ? canonical.decimals : indexedDecimals(contract.decimal);
  const { hash, from, to, timestamp, uniqueId } = common;
  const id = `${chainId}:${hash.toLowerCase()}:${from.toLowerCase()}:${to.toLowerCase()}:${tokenAddress?.toLowerCase() ?? 'native'}:${amountRaw}:${uniqueId ?? index}`;
  return {
    malformed: false,
    item: { chainId, hash, timestamp, from, to, amountRaw, symbol, decimals, tokenAddress, verified: Boolean(canonical), id },
  };
}

function parsePositionTransfer(rawValue: unknown, wallet: Address, stream: WalletTransferStream, index: number): Parsed<WalletPositionTransfer> {
  const raw = record(rawValue);
  const contract = record(raw?.rawContract);
  const pool = contract?.address;
  const tokenIdValue = typeof raw?.tokenId === 'string' ? raw.tokenId : raw?.erc721TokenId;
  const common = parseCommon(raw, wallet, stream);
  if (!common || raw?.category !== 'erc721' || typeof pool !== 'string' || !isAddress(pool)
    || typeof tokenIdValue !== 'string' || !QUANTITY_PATTERN.test(tokenIdValue)) return { malformed: true };
  // The request is limited to the four pools; anything else is not this index's answer.
  if (!POSITION_POOL_SET.has(pool.toLowerCase())) return { malformed: true };
  const tokenId = BigInt(tokenIdValue);
  const { hash, from, to, timestamp, uniqueId } = common;
  const id = `1:${hash.toLowerCase()}:${from.toLowerCase()}:${to.toLowerCase()}:${pool.toLowerCase()}:${tokenId}:${uniqueId ?? index}`;
  return { malformed: false, item: { chainId: 1, hash, timestamp, from, to, pool: getAddress(pool), tokenId, id } };
}

async function loadUncached(
  address: Address,
  cursors: WalletTransferCursorMap,
  dependencies: WalletTransferHistoryDependencies,
): Promise<WalletTransferHistoryResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const endpoints: Record<WalletTransferChain, string[]> = {
    1: configuredAlchemyUrls(1, dependencies.getRpcUrls),
    8453: configuredAlchemyUrls(8453, dependencies.getRpcUrls),
  };
  const paginating = Object.keys(cursors).length > 0;

  const result: WalletTransferHistoryResult = { items: [], positionTransfers: [], partial: false, cursors: emptyCursors() };
  const seen = new Set<string>();
  const accept = (item: WalletTransfer | WalletPositionTransfer, list: (WalletTransfer | WalletPositionTransfer)[]) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    list.push(item);
  };
  const readPage = async (chainId: WalletTransferChain, stream: WalletTransferStream, cursor: string | undefined) => {
    const request = () => rpcRequest(fetcher, endpoints[chainId], requestParams(address, chainId, stream, cursor), timeoutMs);
    try {
      return record(await request());
    } catch (error) {
      if (!(error instanceof UnsupportedInternalCategoryError)) throw error;
      internalUnsupported.add(chainId);
      return record(await request());
    }
  };
  const requests = CHAINS.flatMap((chainId) => CHAIN_STREAMS[chainId].map(async (stream) => {
    const requestCursor = cursors[chainId]?.[stream];
    // A pagination request must not restart streams that already reached the end.
    if (paginating && !requestCursor) return;
    if (endpoints[chainId].length === 0) {
      result.partial = true;
      result.cursors[chainId][stream] = requestCursor ?? null;
      return;
    }
    let cursor = requestCursor;
    for (let page = 0; page < (paginating ? 1 : FIRST_LOAD_PAGES); page += 1) {
      let response: JsonRecord | null;
      try {
        response = await readPage(chainId, stream, cursor);
      } catch {
        // Keep the last good cursor so "Load more" can retry from there.
        result.partial = true;
        result.cursors[chainId][stream] = cursor ?? null;
        return;
      }
      const rawNextCursor = response?.pageKey;
      const nextCursor = normalizeCursor(rawNextCursor);
      if (rawNextCursor !== undefined && rawNextCursor !== '' && !nextCursor) result.partial = true;
      result.cursors[chainId][stream] = nextCursor ?? null;
      const transfers = response?.transfers;
      if (!Array.isArray(transfers)) { result.partial = true; return; }
      transfers.forEach((item, index) => {
        const parsed = isPositionStream(stream)
          ? parsePositionTransfer(item, address, stream, index)
          : parseTransfer(item, chainId, address, stream, index);
        if (parsed.malformed) result.partial = true;
        if (parsed.item) accept(parsed.item, isPositionStream(stream) ? result.positionTransfers : result.items);
      });
      if (!nextCursor) return;
      cursor = nextCursor;
    }
  }));
  await Promise.all(requests);
  result.items.sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id));
  result.positionTransfers.sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id));
  return result;
}

/** Fungible streams that can still load older rows; NFT evidence alone never adds rows. */
export function hasMoreWalletTransfers(result: Pick<WalletTransferHistoryResult, 'cursors'> | undefined): boolean {
  return Boolean(result && CHAINS.some((chainId) => result.cursors[chainId]?.sent || result.cursors[chainId]?.received));
}

/** Cursor map for the next "Load more": every stream that has one. */
export function nextWalletTransferCursors(result: Pick<WalletTransferHistoryResult, 'cursors'>): WalletTransferCursorMap {
  const cursors: WalletTransferCursorMap = {};
  for (const chainId of CHAINS) for (const stream of CHAIN_STREAMS[chainId]) {
    const cursor = result.cursors[chainId]?.[stream];
    if (cursor) { cursors[chainId] ??= {}; cursors[chainId]![stream] = cursor; }
  }
  return cursors;
}

/** Load two bounded pages per stream on Ethereum and Base (fewer when a stream
 * ends). With explicit cursors, read exactly one page per given stream. */
export function loadWalletTransferHistory(
  walletAddress: string,
  cursorsInput?: WalletTransferCursorMap,
  dependencies: WalletTransferHistoryDependencies = {},
): Promise<WalletTransferHistoryResult> {
  const addressValid = isAddress(walletAddress);
  if (!addressValid) return Promise.resolve({ items: [], positionTransfers: [], partial: true, cursors: emptyCursors() });
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

/** Test hook: forget what the indexer reported about unsupported categories. */
export function resetWalletTransferHistoryForTests(): void {
  internalUnsupported.clear();
  resultCache.clear();
  inFlight.clear();
}
