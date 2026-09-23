import {
  decodeEventLog,
  isAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { assertPublicClientChain, getEthereumClient } from './fx/clients';
import { positionPoolAddress } from './fx/policy';
import { withReadDeadline } from './fx/readFacade';
import type { FxPublicClient } from './fx/types';

const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708' as Address;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const POSITIONS_PER_PAGE = 25;
const ORDERS_PER_PAGE = 5;
const MAX_VERIFIED_TRANSACTIONS = 20;

/** Public indexes used by fx-sdk@1.0.5 getPositions for each market and side. */
const INDEXES = [
  { market: 'ETH', side: 'long', url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth/3.0.0/gn' },
  { market: 'BTC', side: 'long', url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wbtc/3.0.0/gn' },
  // The pinned SDK's wstETH short index is older and has no `realOwner` field.
  { market: 'ETH', side: 'short', supportsRealOwner: false, url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wsteth-short/v0.1.0/gn' },
  { market: 'BTC', side: 'short', url: 'https://api.goldsky.com/api/public/project_cmgz5g9sl0065xhp2aqd9c6sv/subgraphs/fx-v2-wbtc-short/v2.0.0/gn' },
] as const;

const CLOSE_EVENT = [{
  type: 'event', name: 'CloseOrRemove', anonymous: false,
  inputs: [
    { name: 'pool', type: 'address', indexed: false },
    { name: 'position', type: 'uint256', indexed: false },
    { name: 'recipient', type: 'address', indexed: false },
    { name: 'colls', type: 'uint256', indexed: false },
    { name: 'debts', type: 'uint256', indexed: false },
    { name: 'borrows', type: 'uint256', indexed: false },
  ],
}] as const;

const OPEN_EVENT = [{
  type: 'event', name: 'OpenOrAdd', anonymous: false,
  inputs: [
    { name: 'pool', type: 'address', indexed: false },
    { name: 'position', type: 'uint256', indexed: false },
    { name: 'recipient', type: 'address', indexed: false },
    { name: 'colls', type: 'uint256', indexed: false },
    { name: 'debts', type: 'uint256', indexed: false },
    { name: 'borrows', type: 'uint256', indexed: false },
  ],
}] as const;

type Market = (typeof INDEXES)[number]['market'];
type Side = (typeof INDEXES)[number]['side'];
export type ProtocolActivityKind = 'open' | 'reduce' | 'close';

export interface ProtocolPositionActivity {
  chainId: 1;
  hash: Hex;
  positionId: number;
  market: Market;
  side: Side;
  kind: ProtocolActivityKind;
  poolAddress: Address;
  blockNumber: bigint;
  timestamp: number;
}

export interface ProtocolHistoryCursor {
  /** Offset in this market's wallet-linked position set. */
  positions: number;
  /** Offset in this page's ordered Open/Close protocol records. */
  orders: number;
}

export interface ProtocolPositionHistoryResult {
  items: ProtocolPositionActivity[];
  partial: boolean;
  /** One cursor per market index; `-1` means that index is exhausted. */
  cursor: ProtocolHistoryCursor[];
  hasMore: boolean;
}

interface Candidate extends ProtocolPositionActivity {
  poolAddress: Address;
}

interface IndexPage {
  candidates: Candidate[];
  next: ProtocolHistoryCursor | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decimalBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function parsePositionId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositionPage(value: unknown): Map<string, { isClosed: boolean; blockNumber: bigint }> {
  const data = asRecord(asRecord(value)?.data);
  if (!Array.isArray(data?.positions)) throw new Error('The protocol index returned an unexpected response.');
  const positions = new Map<string, { isClosed: boolean; blockNumber: bigint }>();
  for (const rawPosition of data.positions.slice(0, POSITIONS_PER_PAGE)) {
    const position = asRecord(rawPosition);
    const id = typeof position?.id === 'string' ? position.id : '';
    const blockNumber = decimalBigInt(position?.blockNumber);
    if (!parsePositionId(id) || blockNumber === null || typeof position?.isClosed !== 'boolean') continue;
    positions.set(id, { isClosed: position.isClosed, blockNumber });
  }
  return positions;
}

function indexedPositionId(order: Record<string, unknown>, hash: Hex, positions: Map<string, { isClosed: boolean; blockNumber: bigint }>): string | null {
  const explicitId = typeof order.positionId === 'string' ? order.positionId : null;
  const entityId = typeof order.id === 'string' ? order.id : null;
  if (entityId) {
    // Goldsky's Order entity exposes identity as `${positionId}_${transactionHash}`;
    // `positionId` is accepted as a filter but omitted from selected response fields.
    const match = entityId.match(/^([1-9][0-9]{0,15})_(0x[0-9a-f]{64})$/i);
    if (match && match[2].toLowerCase() === hash.toLowerCase() && positions.has(match[1])) {
      if (explicitId !== null && explicitId !== match[1]) return null;
      return match[1];
    }
    if (explicitId === null) return null;
  }
  return explicitId !== null && positions.has(explicitId) ? explicitId : null;
}

function parseOrder(value: unknown, positions: Map<string, { isClosed: boolean; blockNumber: bigint }>, index: (typeof INDEXES)[number]): Candidate | null {
  const order = asRecord(value);
  if (!order || (order.type !== 'Open' && order.type !== 'Close')) return null;
  const hash = typeof order.hash === 'string' && HASH_PATTERN.test(order.hash) ? order.hash.toLowerCase() as Hex : null;
  const positionIdRaw = hash ? indexedPositionId(order, hash, positions) : null;
  const positionState = positionIdRaw ? positions.get(positionIdRaw) : undefined;
  const positionId = positionIdRaw ? parsePositionId(positionIdRaw) : null;
  const blockNumber = decimalBigInt(order.blockNumber);
  const timestampRaw = decimalBigInt(order.timestamp);
  if (!positionState || positionId === null || !hash || blockNumber === null || timestampRaw === null
    || timestampRaw <= 0n || timestampRaw > 8_640_000_000_000n) return null;

  // `Close` covers both reductions and full closes. The indexer's closed flag
  // and final position block distinguish the final close from older reductions.
  const kind: ProtocolActivityKind = order.type === 'Open'
    ? 'open'
    : positionState.isClosed && positionState.blockNumber === blockNumber ? 'close' : 'reduce';
  return {
    chainId: 1,
    hash,
    positionId,
    market: index.market,
    side: index.side,
    kind,
    blockNumber,
    timestamp: Number(timestampRaw),
    poolAddress: positionPoolAddress(index.market, index.side),
  };
}

function positionsQuery(walletAddress: Address, offset: number, supportsRealOwner: boolean): string {
  const walletFilter = supportsRealOwner
    ? `or: [{ owner: "${walletAddress}" }, { realOwner: "${walletAddress}" }]`
    : `owner: "${walletAddress}"`;
  return `query WalletPositionHistory { positions(first: ${POSITIONS_PER_PAGE}, skip: ${offset}, where: { ${walletFilter} }, orderBy: blockNumber, orderDirection: desc) { id isClosed blockNumber } }`;
}

async function queryIndex(
  index: (typeof INDEXES)[number],
  walletAddress: Address,
  fetcher: typeof fetch,
  cursor: ProtocolHistoryCursor,
): Promise<IndexPage> {
  if (cursor.positions < 0) return { candidates: [], next: null };
  const positionResponse = await fetcher(index.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: positionsQuery(walletAddress, cursor.positions, !('supportsRealOwner' in index) || index.supportsRealOwner) }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!positionResponse.ok) throw new Error(`Protocol index returned HTTP ${positionResponse.status}.`);
  const positionBody: unknown = await positionResponse.json();
  if (Array.isArray(asRecord(positionBody)?.errors) && (asRecord(positionBody)?.errors as unknown[]).length > 0) throw new Error('Protocol index query failed.');
  const positions = parsePositionPage(positionBody);
  if (positions.size === 0) return { candidates: [], next: null };

  const positionIds = [...positions.keys()];
  const orderQuery = `query WalletPositionOrders { orders(first: ${ORDERS_PER_PAGE}, skip: ${cursor.orders}, where: { positionId_in: [${positionIds.map((id) => `"${id}"`).join(',')}], type_in: ["Open", "Close"] }, orderBy: blockNumber, orderDirection: desc) { id type hash blockNumber timestamp } }`;
  const orderResponse = await fetcher(index.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: orderQuery }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!orderResponse.ok) throw new Error(`Protocol index returned HTTP ${orderResponse.status}.`);
  const orderBody: unknown = await orderResponse.json();
  const orderRoot = asRecord(orderBody);
  const orderData = asRecord(orderRoot?.data);
  if (Array.isArray(orderRoot?.errors) && orderRoot.errors.length > 0) throw new Error('Protocol index query failed.');
  if (!Array.isArray(orderData?.orders)) throw new Error('The protocol index returned an unexpected response.');
  const candidates = orderData.orders.slice(0, ORDERS_PER_PAGE)
    .map((order) => parseOrder(order, positions, index))
    .filter((candidate): candidate is Candidate => candidate !== null);
  const next = orderData.orders.length >= ORDERS_PER_PAGE
    ? { positions: cursor.positions, orders: cursor.orders + ORDERS_PER_PAGE }
    : positions.size >= POSITIONS_PER_PAGE
      ? { positions: cursor.positions + POSITIONS_PER_PAGE, orders: 0 }
      : null;
  return { candidates, next };
}

function sameAddress(left: unknown, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

function decodeMatchingEvent(log: TransactionReceipt['logs'][number], candidate: Candidate, walletAddress: Address): boolean {
  if (log.removed || !sameAddress(log.address, ROUTER)) return false;
  const abi = candidate.kind === 'open' ? OPEN_EVENT : CLOSE_EVENT;
  try {
    const { eventName, args } = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
    const expectedName = candidate.kind === 'open' ? 'OpenOrAdd' : 'CloseOrRemove';
    return eventName === expectedName
      && sameAddress(args.pool, candidate.poolAddress)
      && args.position === BigInt(candidate.positionId)
      && sameAddress(args.recipient, walletAddress);
  } catch {
    return false;
  }
}

async function verifyCandidates(candidates: Candidate[], walletAddress: Address, client: FxPublicClient): Promise<ProtocolPositionActivity[]> {
  const first = candidates[0];
  if (!first) return [];
  try {
    const receipt = await withReadDeadline(client.getTransactionReceipt({ hash: first.hash }));
    if (receipt.status !== 'success'
      || !sameAddress(receipt.transactionHash, first.hash)) return [];
    const events = candidates.filter((candidate) => candidate.blockNumber === receipt.blockNumber
      && receipt.logs.some((log) => sameAddress(log.transactionHash, candidate.hash)
        && log.blockNumber === receipt.blockNumber
        && sameAddress(log.blockHash, receipt.blockHash)
        && decodeMatchingEvent(log, candidate, walletAddress)));
    return events.map((candidate) => ({
      chainId: 1,
      hash: candidate.hash,
      positionId: candidate.positionId,
      market: candidate.market,
      side: candidate.side,
      kind: candidate.kind,
      poolAddress: candidate.poolAddress,
      blockNumber: candidate.blockNumber,
      timestamp: candidate.timestamp,
    }));
  } catch {
    return [];
  }
}

async function mapBounded<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function nextCursor(result: PromiseSettledResult<IndexPage>, current: ProtocolHistoryCursor): ProtocolHistoryCursor {
  if (result.status === 'rejected') return current;
  return result.value.next ?? { positions: -1, orders: -1 };
}

/**
 * Read one bounded page of wallet-linked position activity, then verify each
 * displayed row against a successful Ethereum receipt and protocol router log.
 */
export async function loadProtocolPositionHistory(params: {
  walletAddress: string;
  client?: FxPublicClient;
  fetcher?: typeof fetch;
  cursor?: ProtocolHistoryCursor[];
}): Promise<ProtocolPositionHistoryResult> {
  if (!isAddress(params.walletAddress, { strict: false })) throw new Error('Connect a valid wallet to load protocol activity.');
  const walletAddress = params.walletAddress.toLowerCase() as Address;
  const fetcher = params.fetcher ?? fetch;
  const cursors = INDEXES.map((_, index) => params.cursor?.[index] ?? { positions: 0, orders: 0 });
  const indexResults = await Promise.allSettled(INDEXES.map((index, i) => queryIndex(index, walletAddress, fetcher, cursors[i])));
  const candidates = indexResults.flatMap((result) => result.status === 'fulfilled' ? result.value.candidates : []);
  if (indexResults.every((result) => result.status === 'rejected')) throw new Error('Protocol activity could not be loaded. Retry when network access is available.');

  const byHash = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.chainId}:${candidate.hash}`;
    const group = byHash.get(key) ?? [];
    if (!group.some((item) => item.positionId === candidate.positionId && item.market === candidate.market && item.side === candidate.side && item.kind === candidate.kind)) group.push(candidate);
    byHash.set(key, group);
  }
  const latest = [...byHash.entries()]
    .map(([key, group]) => [key, group.sort((left, right) => right.blockNumber === left.blockNumber ? right.timestamp - left.timestamp : left.blockNumber > right.blockNumber ? -1 : 1)] as const)
    .sort((left, right) => {
      const first = left[1][0];
      const second = right[1][0];
      return second.blockNumber === first.blockNumber ? second.timestamp - first.timestamp : second.blockNumber > first.blockNumber ? 1 : -1;
    })
    .slice(0, MAX_VERIFIED_TRANSACTIONS);
  const expectedEventKeys = new Set(latest.flatMap(([, group]) => group.map((candidate) => `${candidate.chainId}:${candidate.hash}:${candidate.poolAddress.toLowerCase()}:${candidate.positionId}:${candidate.kind}`)));

  let client = params.client;
  if (latest.length > 0) {
    client ??= getEthereumClient();
    await withReadDeadline(assertPublicClientChain(client, 1));
  }
  const verified = client ? (await mapBounded(latest, 4, ([, group]) => verifyCandidates(group, walletAddress, client!))).flat() : [];
  const itemsByEvent = new Map<string, ProtocolPositionActivity>();
  for (const item of verified) if (item) {
    const key = `${item.chainId}:${item.hash}:${item.poolAddress.toLowerCase()}:${item.positionId}:${item.kind}`;
    itemsByEvent.set(key, item);
  }
  const cursor = INDEXES.map((_, index) => nextCursor(indexResults[index], cursors[index]));
  return {
    items: [...itemsByEvent.values()].sort((left, right) => right.blockNumber === left.blockNumber ? right.timestamp - left.timestamp : left.blockNumber > right.blockNumber ? -1 : 1),
    partial: indexResults.some((result) => result.status === 'rejected') || [...expectedEventKeys].some((key) => !itemsByEvent.has(key)),
    cursor,
    hasMore: cursor.some((item) => item.positions >= 0),
  };
}
