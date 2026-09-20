import type { Address } from 'viem';
import { positionPoolAddress } from '@/lib/fx/policy';
import type { FxPublicClient } from '@/lib/fx/types';
import type { PositionGroup } from './fxUi';

/**
 * The four f(x) position pools are ERC-721 contracts, but they do not expose
 * ERC-721Enumerable.  Discovery therefore uses the wallet balance as the
 * completeness oracle and ownerOf only for a bounded token-id scan.
 */
export const POSITION_NFT_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getNextPositionId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'nextPositionId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const;

/** A scan is deliberately small enough to be safe on a public RPC endpoint. */
export const DIRECT_POSITION_SCAN_MAX_IDS = 4_096;
export const DIRECT_POSITION_SCAN_BATCH_SIZE = 128;
export const DIRECT_POSITION_SCAN_CONCURRENCY = 2;
export const DIRECT_POSITION_SCAN_DEADLINE_MS = 12_000;
export const DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES = 128;

type ReadContract = FxPublicClient['readContract'];
type MulticallResult = { status?: string; result?: unknown } | unknown;
type DiscoveryClient = Pick<FxPublicClient, 'readContract'> & {
  multicall?: (args: {
    contracts: readonly {
      address: Address;
      abi: typeof POSITION_NFT_ABI;
      functionName: 'ownerOf';
      args: readonly [bigint];
    }[];
    allowFailure: true;
  }) => Promise<readonly MulticallResult[]>;
};

// Candidate IDs only. Accounting and actionability are never cached; every
// reuse is checked against the current balance and ownerOf values.
const candidateIdCache = new Map<string, number[]>();

export interface DirectPositionDiscoveryParams {
  client: DiscoveryClient;
  group: PositionGroup;
  walletAddress: Address;
  /** IDs already hydrated and ownerOf-verified by the fast SDK path. */
  verifiedIndexerIds: readonly number[];
  /** ERC-721 balanceOf read immediately before discovery. */
  expectedCount?: bigint;
  /** Shared refresh deadline, so a slow indexer cannot add another full timeout. */
  deadlineAt?: number;
}

export interface DirectPositionDiscoveryResult {
  ids: number[];
  expectedCount: bigint;
  usedScan: boolean;
}

function assertPositionId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function readResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'status' in value) {
    const result = value as { status?: unknown; result?: unknown };
    return result.status === 'success' ? result.result : undefined;
  }
  return value;
}

function asCount(value: unknown): bigint {
  const result = readResult(value);
  if (typeof result !== 'bigint' || result < 0n) throw new TypeError('position NFT balance was malformed');
  return result;
}

function ownerMatches(value: unknown, walletAddress: string): boolean {
  const owner = readResult(value);
  return typeof owner === 'string' && owner.toLowerCase() === walletAddress.toLowerCase();
}

function asNextId(value: unknown): number {
  const result = readResult(value);
  if (typeof result !== 'bigint' || result < 1n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('position NFT next ID was malformed');
  }
  return Number(result);
}

function uniqueVerifiedIds(ids: readonly number[]): number[] {
  const unique = new Set<number>();
  for (const id of ids) unique.add(assertPositionId(id, 'verified position ID'));
  return [...unique].sort((a, b) => a - b);
}

async function withDeadline<T>(task: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('direct position scan deadline exceeded');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('direct position scan deadline exceeded')), remaining);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBalance(client: DiscoveryClient, pool: Address, walletAddress: Address): Promise<bigint> {
  const value = await client.readContract({
    address: pool,
    abi: POSITION_NFT_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  } as Parameters<ReadContract>[0]);
  return asCount(value);
}

/** Read the canonical ERC-721 ownership count before consulting the indexer. */
export async function readDirectWalletPositionCount(params: {
  client: DiscoveryClient;
  group: PositionGroup;
  walletAddress: Address;
  deadlineAt?: number;
}): Promise<bigint> {
  const deadline = params.deadlineAt ?? Date.now() + DIRECT_POSITION_SCAN_DEADLINE_MS;
  return withDeadline(readBalance(params.client, positionPoolAddress(params.group.market, params.group.side), params.walletAddress), deadline);
}

async function scanOwners(params: {
  client: DiscoveryClient;
  pool: Address;
  walletAddress: Address;
  nextId: number;
  expectedCount: bigint;
  deadline: number;
}): Promise<number[]> {
  if (!params.client.multicall) throw new Error('direct position scan requires multicall support');
  if (params.nextId - 1 > DIRECT_POSITION_SCAN_MAX_IDS) {
    throw new Error(`direct position scan exceeds ${DIRECT_POSITION_SCAN_MAX_IDS} token IDs`);
  }

  const found = new Set<number>();
  const lastId = params.nextId - 1;
  for (let start = 1; start <= lastId; start += DIRECT_POSITION_SCAN_BATCH_SIZE * DIRECT_POSITION_SCAN_CONCURRENCY) {
    const jobs: Promise<readonly MulticallResult[]>[] = [];
    for (let offset = 0; offset < DIRECT_POSITION_SCAN_CONCURRENCY; offset += 1) {
      const batchStart = start + offset * DIRECT_POSITION_SCAN_BATCH_SIZE;
      if (batchStart > lastId) break;
      const batchEnd = Math.min(batchStart + DIRECT_POSITION_SCAN_BATCH_SIZE - 1, lastId);
      const contracts = Array.from({ length: batchEnd - batchStart + 1 }, (_, index) => ({
        address: params.pool,
        abi: POSITION_NFT_ABI,
        functionName: 'ownerOf' as const,
        args: [BigInt(batchStart + index)] as readonly [bigint],
      }));
      jobs.push(withDeadline(params.client.multicall({ contracts, allowFailure: true }), params.deadline));
    }
    const results = await Promise.all(jobs);
    results.forEach((batch, batchIndex) => {
      const batchStart = start + batchIndex * DIRECT_POSITION_SCAN_BATCH_SIZE;
      batch.forEach((result, index) => {
        if (ownerMatches(result, params.walletAddress)) found.add(batchStart + index);
      });
    });
    if (BigInt(found.size) === params.expectedCount) {
      // A balance reread closes the race where a new NFT arrives after the
      // initial count. If it changed, continue as incomplete rather than
      // presenting the early subset as the complete wallet.
      const finalCount = await withDeadline(readBalance(params.client, params.pool, params.walletAddress), params.deadline);
      if (finalCount === params.expectedCount) return [...found].sort((a, b) => a - b);
      throw new Error('direct position scan was incomplete');
    }
  }

  if (BigInt(found.size) !== params.expectedCount) {
    throw new Error('direct position scan was incomplete');
  }
  return [...found].sort((a, b) => a - b);
}

async function verifyCachedOwners(params: {
  client: DiscoveryClient;
  pool: Address;
  walletAddress: Address;
  ids: readonly number[];
  expectedCount: bigint;
  deadline: number;
}): Promise<number[] | null> {
  if (!params.client.multicall || BigInt(params.ids.length) !== params.expectedCount) return null;
  const results: MulticallResult[] = [];
  for (let start = 0; start < params.ids.length; start += DIRECT_POSITION_SCAN_BATCH_SIZE) {
    const batchIds = params.ids.slice(start, start + DIRECT_POSITION_SCAN_BATCH_SIZE);
    const batch = await withDeadline(params.client.multicall({
      contracts: batchIds.map((id) => ({
        address: params.pool,
        abi: POSITION_NFT_ABI,
        functionName: 'ownerOf' as const,
        args: [BigInt(id)] as readonly [bigint],
      })),
      allowFailure: true,
    }), params.deadline);
    results.push(...batch);
  }
  const valid = params.ids.filter((_, index) => ownerMatches(results[index], params.walletAddress));
  return BigInt(valid.length) === params.expectedCount ? [...valid] : null;
}

/**
 * Reconcile indexer IDs against the canonical ERC-721 count.  A complete
 * verified indexer response remains the fast path.  Any deficit or indexer
 * failure must take the bounded ownerOf path; a capped/failed scan rejects so
 * callers can retain a stale snapshot instead of presenting an empty wallet.
 */
export async function discoverDirectWalletPositionIds(
  params: DirectPositionDiscoveryParams,
): Promise<DirectPositionDiscoveryResult> {
  const pool = positionPoolAddress(params.group.market, params.group.side);
  const deadline = params.deadlineAt ?? Date.now() + DIRECT_POSITION_SCAN_DEADLINE_MS;
  const expectedCount = params.expectedCount ?? await withDeadline(readBalance(params.client, pool, params.walletAddress), deadline);
  if (expectedCount > BigInt(DIRECT_POSITION_SCAN_MAX_IDS)) {
    throw new Error(`position NFT balance exceeds ${DIRECT_POSITION_SCAN_MAX_IDS} supported IDs`);
  }

  const indexedIds = uniqueVerifiedIds(params.verifiedIndexerIds);
  if (expectedCount === 0n) return { ids: [], expectedCount, usedScan: false };
  if (BigInt(indexedIds.length) === expectedCount) {
    return { ids: indexedIds, expectedCount, usedScan: false };
  }

  const cacheKey = `1:${pool.toLowerCase()}:${params.walletAddress.toLowerCase()}`;
  const cached = candidateIdCache.get(cacheKey);
  if (cached) {
    const reused = await verifyCachedOwners({
      client: params.client,
      pool,
      walletAddress: params.walletAddress,
      ids: cached,
      expectedCount,
      deadline,
    });
    if (reused) return { ids: reused, expectedCount, usedScan: true };
    candidateIdCache.delete(cacheKey);
  }

  const nextIdValue = await withDeadline(params.client.readContract({
    address: pool,
    abi: POSITION_NFT_ABI,
    functionName: 'getNextPositionId',
  } as Parameters<ReadContract>[0]), deadline);
  const nextId = asNextId(nextIdValue);
  const ids = await scanOwners({ client: params.client, pool, walletAddress: params.walletAddress, nextId, expectedCount, deadline });
  candidateIdCache.delete(cacheKey);
  candidateIdCache.set(cacheKey, ids);
  while (candidateIdCache.size > DIRECT_POSITION_CANDIDATE_CACHE_MAX_ENTRIES) {
    const oldest = candidateIdCache.keys().next().value;
    if (oldest === undefined) break;
    candidateIdCache.delete(oldest);
  }
  return { ids, expectedCount, usedScan: true };
}
