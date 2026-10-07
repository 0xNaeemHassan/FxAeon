import { formatUnits } from 'viem';
import { fetchEthereumGasFallback } from './etherscanGas';
import { getPublicClient } from './clients';
import { assertSupportedChainId } from './config';
import type { FxChainId, FxPublicClient } from './types';
import type { GasTier } from '@/lib/settings';

export interface GasTierQuote {
  tier: GasTier;
  /** Estimated current total price, used for the visible tier/rate. */
  gasPriceWei: bigint;
  /** EIP-1559 cap and tip for embedded-wallet transactions; external wallets choose their own. */
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  source?: 'rpc' | 'etherscan';
  /** Quote deadline when selected out of a bounded snapshot. */
  validUntil?: number;
}

export interface GasTierQuotes {
  chainId: FxChainId;
  fetchedAt: number;
  validUntil: number;
  source: 'rpc' | 'etherscan';
  baseFeePerGasWei: bigint;
  tiers: Record<GasTier, GasTierQuote>;
}

export interface GasFeeSelection {
  snapshot: GasTierQuotes;
  tier: GasTier;
}

export const GAS_TIER_QUOTE_TTL_MS = 30_000;
const GAS_RPC_TIMEOUT_MS = 8_000;
// Give the optional same-origin oracle a short head start, then overlap the
// independent chain-native read instead of putting its full timeout first.
const GAS_RPC_HEDGE_DELAY_MS = 200;
const MAX_FEE_PER_GAS_WEI = 1_000_000_000_000_000_000n;
const GAS_TIERS: readonly GasTier[] = ['standard', 'fast', 'rapid'];
const gasQuoteCache = new Map<FxChainId, GasTierQuotes>();
const gasQuoteRequests = new Map<FxChainId, Promise<GasTierQuotes>>();
let gasQuoteCacheGeneration = 0;

export function resetGasTierQuoteCacheForTests(): void {
  gasQuoteCacheGeneration += 1;
  gasQuoteCache.clear();
  gasQuoteRequests.clear();
}

function validFee(value: bigint): boolean {
  return value > 0n && value <= MAX_FEE_PER_GAS_WEI;
}

export function buildGasTierQuotesFromPrices(
  chainId: FxChainId,
  baseFee: bigint,
  prices: Record<GasTier, bigint>,
  source: GasTierQuotes['source'],
  fetchedAt: number,
  now: number,
): GasTierQuotes {
  if (!validFee(baseFee) || !Number.isSafeInteger(fetchedAt) || fetchedAt < 0
    || fetchedAt > now + 60_000 || now - fetchedAt > GAS_TIER_QUOTE_TTL_MS) {
    throw new Error('network fee quote is stale or invalid');
  }
  let previous = 0n;
  const tiers = {} as Record<GasTier, GasTierQuote>;
  for (const tier of GAS_TIERS) {
    const gasPriceWei = prices[tier];
    if (!validFee(gasPriceWei) || gasPriceWei < baseFee || gasPriceWei < previous) {
      throw new Error('network fee tiers are invalid');
    }
    const maxPriorityFeePerGas = gasPriceWei - baseFee;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    if (!validFee(maxFeePerGas) || maxPriorityFeePerGas > maxFeePerGas) {
      throw new Error('network fee tier exceeds supported bounds');
    }
    tiers[tier] = { tier, gasPriceWei, maxFeePerGas, maxPriorityFeePerGas, source };
    previous = gasPriceWei;
  }
  return {
    chainId,
    fetchedAt,
    validUntil: Math.min(now + GAS_TIER_QUOTE_TTL_MS, fetchedAt + GAS_TIER_QUOTE_TTL_MS),
    source,
    baseFeePerGasWei: baseFee,
    tiers,
  };
}

function fromHex(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error('fee history returned an invalid quantity');
  }
  return BigInt(value);
}

interface FeeHistoryResult {
  baseFeePerGas?: unknown;
  reward?: unknown;
}

function isLocalForkMode(): boolean {
  return typeof process !== 'undefined'
    && (process.env.NEXT_PUBLIC_FX_SCREENSHOT_MODE === '1'
      || process.env.NEXT_PUBLIC_FX_LOCAL_FORK_TEST_MODE === '1');
}

async function withTimeout<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('network fee RPC timed out')), GAS_RPC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function buildRpcGasTierQuotes(chainId: FxChainId, raw: unknown, now: number): GasTierQuotes {
  if (!raw || typeof raw !== 'object') throw new Error('fee history response is invalid');
  const response = raw as FeeHistoryResult;
  if (!Array.isArray(response.baseFeePerGas) || response.baseFeePerGas.length !== 6
    || !Array.isArray(response.reward) || response.reward.length !== 5) {
    throw new Error('fee history response is incomplete');
  }
  // feeHistory appends the next-block base fee. The preceding element is the
  // current head's base fee; the latest reward row contains recent tips.
  const baseFee = fromHex(response.baseFeePerGas[response.baseFeePerGas.length - 2]);
  const rewardRows = response.reward.map((row) => {
    if (!Array.isArray(row) || row.length !== 3) throw new Error('fee history rewards are incomplete');
    return row.map(fromHex);
  });
  const medianTip = (index: number) => rewardRows.map((row) => row[index]).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)[2];
  const tips = [medianTip(0), medianTip(1), medianTip(2)];
  return buildGasTierQuotesFromPrices(chainId, baseFee, {
    standard: baseFee + tips[0],
    fast: baseFee + tips[1],
    rapid: baseFee + tips[2],
  }, 'rpc', now, now);
}

async function fetchRpcTierQuotes(chainId: FxChainId, now: number): Promise<GasTierQuotes> {
  const client = getPublicClient(chainId) as FxPublicClient & {
    request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
  };
  const raw = await withTimeout(client.request({
    method: 'eth_feeHistory',
    params: ['0x5', 'latest', [20, 50, 90]],
  }));
  return buildRpcGasTierQuotes(chainId, raw, now);
}

/** Fetch short-lived, chain-native tier quotes. Only Ethereum may use the
 * reviewed Etherscan oracle; Base always prices itself through its own RPC. */
export async function fetchGasTierQuotes(
  chainId: FxChainId,
  options: {
    now?: () => number;
    forceRefresh?: boolean;
    /** Re-price from the source a reviewed fee came from; the two sources compute tips differently. */
    preferSource?: GasTierQuotes['source'];
    fetchSnapshot?: () => Promise<GasTierQuotes>;
  } = {},
): Promise<GasTierQuotes> {
  assertSupportedChainId(chainId);
  const now = options.now ?? Date.now;
  const requestedAt = now();
  if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) throw new Error('network fee quote clock is invalid');
  const cached = gasQuoteCache.get(chainId);
  if (!options.forceRefresh && cached && cached.validUntil > requestedAt) return cached;
  // A pinned refresh cannot join a shared race that may answer from the other source.
  const pending = options.preferSource ? undefined : gasQuoteRequests.get(chainId);
  if (pending) return pending;
  const generation = gasQuoteCacheGeneration;
  const request = options.fetchSnapshot ? options.fetchSnapshot() : fetchFreshGasTierQuotes(chainId, now, options.preferSource);
  if (!options.preferSource) gasQuoteRequests.set(chainId, request);
  try {
    const snapshot = await request;
    if (generation === gasQuoteCacheGeneration) gasQuoteCache.set(chainId, snapshot);
    return snapshot;
  } finally {
    if (gasQuoteRequests.get(chainId) === request) gasQuoteRequests.delete(chainId);
  }
}

async function fetchOracleTierQuotes(chainId: FxChainId, now: () => number): Promise<GasTierQuotes> {
  const snapshot = await fetchEthereumGasFallback({ now });
  if (!snapshot.stale && snapshot.baseFeePerGasWei && snapshot.tiers) {
    const baseFee = BigInt(snapshot.baseFeePerGasWei);
    const prices = {
      standard: BigInt(snapshot.tiers.standard),
      fast: BigInt(snapshot.tiers.fast),
      rapid: BigInt(snapshot.tiers.rapid),
    } satisfies Record<GasTier, bigint>;
    return buildGasTierQuotesFromPrices(chainId, baseFee, prices, 'etherscan', snapshot.fetchedAt, now());
  }
  throw new Error('network fee oracle is unavailable or stale');
}

async function fetchFreshGasTierQuotes(chainId: FxChainId, now: () => number, preferSource?: GasTierQuotes['source']): Promise<GasTierQuotes> {
  if (chainId !== 1 || isLocalForkMode() || preferSource === 'rpc') return fetchRpcTierQuotes(chainId, now());
  if (preferSource === 'etherscan') {
    // Re-price from the reviewed oracle without a race; the chain stays
    // authoritative only when the oracle cannot answer.
    try {
      return await fetchOracleTierQuotes(chainId, now);
    } catch {
      return fetchRpcTierQuotes(chainId, now());
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let rpcStarted = false;
  let startRpc!: () => void;
  const rpc = new Promise<GasTierQuotes>((resolve, reject) => {
    startRpc = () => {
      if (rpcStarted) return;
      rpcStarted = true;
      clearTimeout(timer);
      void fetchRpcTierQuotes(chainId, now()).then(resolve, reject);
    };
    timer = setTimeout(startRpc, GAS_RPC_HEDGE_DELAY_MS);
  });
  const oracle = fetchOracleTierQuotes(chainId, now).catch((cause: unknown) => {
    // Invalid or failed oracle data should not even wait for the hedge.
    startRpc();
    throw cause;
  });
  try {
    // Both paths validate their complete snapshot before fulfillment. A fast
    // failure cannot win, and a late result cannot replace the reviewed fee.
    // Use ordinary promises to support the app's older browser targets.
    return await new Promise<GasTierQuotes>((resolve, reject) => {
      let failures = 0;
      let rpcError: unknown;
      const rejectIfBothFailed = () => {
        failures += 1;
        // Keep the useful RPC failure used by the previous fallback path.
        if (failures === 2) reject(rpcError);
      };
      void oracle.then(resolve, rejectIfBothFailed);
      void rpc.then(resolve, (cause: unknown) => {
        rpcError = cause;
        rejectIfBothFailed();
      });
    });
  } finally {
    clearTimeout(timer);
  }
}

export function validateGasTierQuote(quote: GasTierQuote, now = Date.now()): GasTierQuote {
  if (quote.validUntil !== undefined && quote.validUntil <= now) throw new Error('network fee quote expired; review the action again');
  if (!GAS_TIERS.includes(quote.tier)) throw new Error('selected network fee tier is unavailable; review the action again');
  if (!validFee(quote.gasPriceWei)
    || !validFee(quote.maxFeePerGas) || quote.maxPriorityFeePerGas < 0n
    || quote.maxPriorityFeePerGas > quote.maxFeePerGas) {
    throw new Error('selected network fee tier is unavailable; review the action again');
  }
  return quote;
}

export function selectedGasTierQuote(snapshot: GasTierQuotes, tier: GasTier, now = Date.now()): GasTierQuote {
  if (snapshot.validUntil <= now) throw new Error('network fee quote expired; review the action again');
  const quote = snapshot.tiers[tier];
  if (!quote || quote.tier !== tier) throw new Error('selected network fee tier is unavailable; review the action again');
  return validateGasTierQuote({ ...quote, validUntil: snapshot.validUntil }, now);
}

export function formatGasTierQuote(quote: GasTierQuote): string {
  return `${quote.tier[0].toUpperCase()}${quote.tier.slice(1)} · ${formatGasPriceGwei(quote.gasPriceWei)} Gwei`;
}

export function formatGasPriceGwei(value: bigint): string {
  const gwei = Number(formatUnits(value, 9));
  if (!Number.isFinite(gwei)) return 'Unavailable';
  return gwei > 0 && gwei < 0.001
    ? '<0.001'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(gwei);
}
