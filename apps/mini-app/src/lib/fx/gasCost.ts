import { formatEther, formatUnits, type Address } from 'viem';
import { assertPublicClientChain, getPublicClient } from './clients';
import { fetchEthereumGasFallback } from './etherscanGas';
import type { FxPublicClient, PlannedRoute, PlannedTransaction } from './types';

/**
 * Gas is a property of the exact reviewed route. It is deliberately kept
 * separate from the route's native `value` and from LayerZero's quoted fees.
 * A route estimate is an informational snapshot and never authorizes signing.
 */
export type GasCostStatus = 'current' | 'partial' | 'unavailable';
export type GasStepStatus = 'estimated' | 'unavailable';

export interface GasFeeSnapshot {
  /** `maxFeePerGas` is a conservative EIP-1559 upper bound when available. */
  mode: 'eip1559-max' | 'legacy';
  feePerGasWei: bigint;
  maxPriorityFeePerGasWei?: bigint;
  /** Provenance for the optional Ethereum-only server-side fallback. */
  source?: 'rpc' | 'etherscan';
  /** The Pages oracle may serve a bounded stale cache during an outage. */
  stale?: boolean;
}

export interface GasStepEstimate {
  index: number;
  kind: PlannedTransaction['kind'];
  status: GasStepStatus;
  gas?: bigint;
  gasFeeWei?: bigint;
  /** Base/OP Stack L1 data fee, when the configured client exposes it. */
  l1DataFeeWei?: bigint;
  /** Base/OP Stack operator fee, when the configured client exposes it. */
  operatorFeeWei?: bigint;
  error?: string;
}

export interface RouteGasCostEstimate {
  /** Account, chain, and transaction fingerprint that this snapshot covers. */
  routeKey: string;
  walletAddress: Address;
  chainId: PlannedRoute['chainId'];
  operation: PlannedRoute['operation'];
  status: GasCostStatus;
  fetchedAt: number;
  validUntil: number;
  /** Latest block observed while resolving the estimate, when available. */
  blockNumber?: bigint;
  fee?: GasFeeSnapshot;
  steps: readonly GasStepEstimate[];
  /** Present only when every route step has a gas estimate. */
  estimatedGasUnits?: bigint;
  /** Present only when every route step and the fee quote are available. */
  executionGasFeeWei?: bigint;
  l1DataFeeWei?: bigint;
  operatorFeeWei?: bigint;
  /** Exact native value carried by the SDK transactions, including zero. */
  nativeValueWei: bigint;
  /** SDK quoted LayerZero native fee, kept separate from execution gas. */
  layerZeroNativeFeeWei?: bigint;
  /** SDK quoted LayerZero token fee; units are protocol token units. */
  layerZeroTokenFeeWei?: bigint;
  /** Native value plus execution gas; absent while either side is unavailable. */
  totalNativeCostWei?: bigint;
  /** Why a total is absent or what its component scope covers. */
  totalNativeCostScope?: 'execution-plus-value' | 'execution-plus-l1-plus-operator-plus-value';
  error?: string;
}

export interface EstimatePlannedRouteCostOptions {
  client?: FxPublicClient;
  signal?: AbortSignal;
  /** Per RPC call timeout. Defaults to eight seconds and is bounded. */
  timeoutMs?: number;
  /** Cache freshness timestamp supplied by tests or a caller-owned clock. */
  now?: () => number;
  /** Freshness lifetime. Defaults to fifteen seconds and is bounded. */
  ttlMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_TTL_MS = 15_000;
const MAX_TTL_MS = 120_000;
const MAX_ROUTE_STEPS = 32;
/** Keep malformed RPC values from producing unbounded arithmetic or UI data. */
export const MAX_FEE_PER_GAS_WEI = 1_000_000_000_000_000_000n;
export const MAX_GAS_UNITS_PER_STEP = 1_000_000_000n;
const MAX_COMPONENT_FEE_WEI = MAX_FEE_PER_GAS_WEI * MAX_GAS_UNITS_PER_STEP;

type GasClient = FxPublicClient & {
  estimateGas?: NonNullable<FxPublicClient['estimateGas']>;
  estimateFeesPerGas?: NonNullable<FxPublicClient['estimateFeesPerGas']>;
  getGasPrice?: NonNullable<FxPublicClient['getGasPrice']>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function nonNegativeBigint(value: unknown): bigint | undefined {
  return typeof value === 'bigint' && value >= 0n ? value : undefined;
}

function positiveBigint(value: unknown): bigint | undefined {
  return typeof value === 'bigint' && value > 0n ? value : undefined;
}

function boundedPositiveBigint(value: unknown, maximum: bigint): bigint | undefined {
  const resolved = positiveBigint(value);
  return resolved !== undefined && resolved <= maximum ? resolved : undefined;
}

function boundedNonNegativeBigint(value: unknown, maximum: bigint): bigint | undefined {
  const resolved = nonNegativeBigint(value);
  return resolved !== undefined && resolved <= maximum ? resolved : undefined;
}

function bridgeQuoteFee(route: PlannedRoute, name: 'nativeFee' | 'lzTokenFee'): bigint | undefined {
  if (route.operation !== 'buildBridgeTx' || !isRecord(route.quote)) return undefined;
  return nonNegativeBigint(route.quote[name]);
}

/**
 * A stable, in-memory-only key. Keeping calldata in the key avoids reusing a
 * gas result for a different route while never persisting or logging it.
 */
export function routeGasCostKey(route: PlannedRoute): string {
  return [
    route.chainId,
    route.walletAddress.toLowerCase(),
    route.operation,
    route.transactions.map((tx) => [
      tx.chainId,
      tx.from.toLowerCase(),
      tx.to.toLowerCase(),
      tx.data.toLowerCase(),
      tx.value.toString(),
      tx.nonce ?? '',
      tx.kind,
    ].join(':')).join('|'),
    bridgeQuoteFee(route, 'nativeFee')?.toString() ?? '',
    bridgeQuoteFee(route, 'lzTokenFee')?.toString() ?? '',
  ].join('::');
}

function assertTimeout(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 250 || resolved > maximum) {
    throw new RangeError(`${label} must be an integer between 250 and ${maximum} milliseconds`);
  }
  return resolved;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('gas estimate cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function boundedCall<T>(
  call: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => {
      const error = new Error('gas estimate cancelled');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('gas RPC request timed out')), timeoutMs);
  });
  try {
    return await Promise.race([call, cancellation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

async function resolveFee(
  client: GasClient,
  timeoutMs: number,
  signal?: AbortSignal,
  chainId?: PlannedRoute['chainId'],
): Promise<GasFeeSnapshot> {
  let firstError: unknown;
  if (client.estimateFeesPerGas) {
    try {
      const fees = await boundedCall(client.estimateFeesPerGas(), timeoutMs, signal);
      const maxFee = boundedPositiveBigint(fees.maxFeePerGas, MAX_FEE_PER_GAS_WEI);
      if (maxFee !== undefined) {
        const priority = nonNegativeBigint(fees.maxPriorityFeePerGas);
        if (priority !== undefined && (priority > maxFee || priority > MAX_FEE_PER_GAS_WEI)) {
          firstError = new Error('fee RPC returned a priority fee above max fee');
        } else {
          return {
            mode: 'eip1559-max',
            feePerGasWei: maxFee,
            ...(priority === undefined ? {} : { maxPriorityFeePerGasWei: priority }),
          };
        }
      }
      const gasPrice = boundedPositiveBigint(fees.gasPrice, MAX_FEE_PER_GAS_WEI);
      if (gasPrice !== undefined) return { mode: 'legacy', feePerGasWei: gasPrice };
      firstError = new Error('fee RPC returned no usable fee per gas');
    } catch (error) {
      if (isAbortError(error)) throw error;
      firstError = error;
    }
  }
  if (client.getGasPrice) {
    try {
      const gasPrice = boundedPositiveBigint(await boundedCall(client.getGasPrice(), timeoutMs, signal), MAX_FEE_PER_GAS_WEI);
      if (gasPrice !== undefined) return { mode: 'legacy', feePerGasWei: gasPrice };
      firstError = firstError ?? new Error('gas price RPC returned an invalid value');
    } catch (error) {
      if (isAbortError(error)) throw error;
      firstError = firstError ?? error;
    }
  }
  // Etherscan is a narrowly scoped read-only price fallback. It cannot supply
  // gas units: every transaction's estimateGas result above remains required.
  // Base deliberately has no fallback because the oracle route is fixed to
  // Ethereum mainnet (chain 1).
  if (chainId === 1) {
    try {
      const snapshot = await boundedCall(fetchEthereumGasFallback({ timeoutMs }), timeoutMs, signal);
      const feePerGasWei = BigInt(snapshot.gasPriceWei);
      if (feePerGasWei > 0n) {
        return {
          mode: 'legacy',
          feePerGasWei,
          source: 'etherscan',
          stale: snapshot.stale,
        };
      }
      firstError = firstError ?? new Error('gas oracle returned an invalid fee per gas');
    } catch (error) {
      if (isAbortError(error)) throw error;
      firstError = firstError ?? error;
    }
  }
  throw new Error(`fee unavailable${firstError instanceof Error ? `: ${firstError.message}` : ''}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatGasUnits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNativeCost(value: bigint): { amount: string; unit: 'ETH' | 'Gwei' } {
  // Tiny estimates are common on test or low-fee networks. Showing eighteen
  // decimal places in ETH obscures the useful number, so retain precision in
  // Gwei below one Gwei and use trimmed ETH above it.
  if (value < 1_000_000_000n) {
    return { amount: formatUnits(value, 9).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'), unit: 'Gwei' };
  }
  return { amount: formatEther(value).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'), unit: 'ETH' };
}

function unavailableEstimate(
  route: PlannedRoute,
  routeKey: string,
  fetchedAt: number,
  validUntil: number,
  nativeValueWei: bigint,
  error: string,
): RouteGasCostEstimate {
  return {
    routeKey,
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    operation: route.operation,
    status: 'unavailable',
    fetchedAt,
    validUntil,
    steps: route.transactions.map((transaction, index) => ({
      index,
      kind: transaction.kind,
      status: 'unavailable',
      error,
    })),
    nativeValueWei,
    layerZeroNativeFeeWei: bridgeQuoteFee(route, 'nativeFee'),
    layerZeroTokenFeeWei: bridgeQuoteFee(route, 'lzTokenFee'),
    error,
  };
}

/**
 * Estimate the exact ordered route against the configured chain RPC.
 * Each transaction is estimated independently: a successful approval remains
 * useful when the following action still requires that approval and therefore
 * cannot be simulated against the current state.
 */
export async function estimatePlannedRouteCost(
  route: PlannedRoute,
  options: EstimatePlannedRouteCostOptions = {},
): Promise<RouteGasCostEstimate> {
  const now = options.now ?? Date.now;
  const fetchedAt = now();
  if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) {
    throw new RangeError('gas estimate clock must return a non-negative safe integer timestamp');
  }
  const ttlMs = assertTimeout(options.ttlMs, DEFAULT_TTL_MS, MAX_TTL_MS, 'gas estimate TTL');
  const timeoutMs = assertTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 'gas RPC timeout');
  if (fetchedAt > Number.MAX_SAFE_INTEGER - ttlMs) {
    throw new RangeError('gas estimate timestamp is too large');
  }
  const routeKey = routeGasCostKey(route);
  const nativeValueWei = route.transactions.reduce((sum, tx) => sum + tx.value, 0n);
  const validUntil = fetchedAt + ttlMs;
  if (route.transactions.length === 0) {
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'route has no transactions');
  }
  if (route.transactions.length > MAX_ROUTE_STEPS) {
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'route has too many transactions to estimate safely');
  }
  if (route.transactions.some((transaction) =>
    transaction.chainId !== route.chainId
    || transaction.from.toLowerCase() !== route.walletAddress.toLowerCase()
  )) {
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'route account or chain scope does not match every transaction');
  }

  const client = (options.client ?? getPublicClient(route.chainId)) as GasClient;
  try {
    throwIfAborted(options.signal);
    await boundedCall(assertPublicClientChain(client, route.chainId), timeoutMs, options.signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return unavailableEstimate(route, routeKey, fetchedAt, validUntil, nativeValueWei, 'chain unavailable');
  }

  let blockNumber: bigint | undefined;
  try {
    blockNumber = await boundedCall(client.getBlockNumber(), timeoutMs, options.signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    // A block tag is useful provenance but is not required for eth_estimateGas.
  }

  // Always settle this parallel request before the step loop completes. If a
  // fee request aborts while eth_estimateGas is still running, leaving a
  // rejected promise pending would surface as an unhandled rejection.
  const feePromise = resolveFee(client, timeoutMs, options.signal, route.chainId)
    .then((fee) => ({ fee } as const))
    .catch((error: unknown) => ({
      feeError: errorText(error),
      feeAbortError: isAbortError(error) ? error : undefined,
    }));
  const steps: GasStepEstimate[] = [];
  for (let index = 0; index < route.transactions.length; index += 1) {
    throwIfAborted(options.signal);
    const transaction = route.transactions[index];
    if (!client.estimateGas) {
      steps.push({ index, kind: transaction.kind, status: 'unavailable', error: 'RPC client does not expose estimateGas' });
      continue;
    }
    try {
      const gas = await boundedCall(client.estimateGas({
        account: transaction.from,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      }), timeoutMs, options.signal);
      if (boundedPositiveBigint(gas, MAX_GAS_UNITS_PER_STEP) === undefined) throw new Error('RPC returned an invalid gas estimate');
      steps.push({ index, kind: transaction.kind, status: 'estimated', gas });
    } catch (error) {
      if (isAbortError(error)) throw error;
      steps.push({ index, kind: transaction.kind, status: 'unavailable', error: safeGasCostError(error) });
    }
  }
  const feeResult = await feePromise;
  if ('feeAbortError' in feeResult && feeResult.feeAbortError) throw feeResult.feeAbortError;
  const allGas = steps.every((step) => step.status === 'estimated' && step.gas !== undefined);
  const estimatedGasUnits = allGas
    ? steps.reduce((sum, step) => sum + (step.gas ?? 0n), 0n)
    : undefined;
  const fee = 'fee' in feeResult ? feeResult.fee : undefined;
  // A stale oracle price remains visible as provenance, but it cannot certify
  // a current execution cost or be used by native-max calculations.
  const usableFee = fee && !fee.stale ? fee : undefined;
  const executionGasFeeWei = allGas && usableFee
    ? steps.reduce((sum, step) => sum + (step.gas ?? 0n) * usableFee.feePerGasWei, 0n)
    : undefined;
  const stepsWithFee = usableFee
    ? steps.map((step) => step.gas === undefined ? step : { ...step, gasFeeWei: step.gas * usableFee.feePerGasWei })
    : steps;
  let completeSteps = stepsWithFee;
  let l1DataFeeWei: bigint | undefined;
  let operatorFeeWei: bigint | undefined;
  let l1Unavailable = false;
  let operatorUnavailable = false;
  if (route.chainId === 8453 && allGas && usableFee) {
    if (!client.estimateL1Fee) l1Unavailable = true;
    if (!client.estimateOperatorFee) operatorUnavailable = true;
    completeSteps = [];
    for (const step of stepsWithFee) {
      const transaction = route.transactions[step.index];
      let l1: bigint | undefined;
      let operator: bigint | undefined;
      if (client.estimateL1Fee) {
        try {
          const result = await boundedCall(client.estimateL1Fee({
            account: route.walletAddress,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            maxFeePerGas: usableFee.feePerGasWei,
            ...(usableFee.maxPriorityFeePerGasWei === undefined ? {} : { maxPriorityFeePerGas: usableFee.maxPriorityFeePerGasWei }),
          }), timeoutMs, options.signal);
          l1 = boundedNonNegativeBigint(result, MAX_COMPONENT_FEE_WEI);
          if (l1 === undefined) l1Unavailable = true;
        } catch (error) {
          if (isAbortError(error)) throw error;
          l1Unavailable = true;
        }
      }
      if (client.estimateOperatorFee) {
        try {
          const result = await boundedCall(client.estimateOperatorFee({
            account: route.walletAddress,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
            maxFeePerGas: usableFee.feePerGasWei,
            ...(usableFee.maxPriorityFeePerGasWei === undefined ? {} : { maxPriorityFeePerGas: usableFee.maxPriorityFeePerGasWei }),
          }), timeoutMs, options.signal);
          operator = boundedNonNegativeBigint(result, MAX_COMPONENT_FEE_WEI);
          if (operator === undefined) operatorUnavailable = true;
        } catch (error) {
          if (isAbortError(error)) throw error;
          operatorUnavailable = true;
        }
      }
      completeSteps.push({ ...step, ...(l1 === undefined ? {} : { l1DataFeeWei: l1 }), ...(operator === undefined ? {} : { operatorFeeWei: operator }) });
    }
    if (!l1Unavailable) l1DataFeeWei = completeSteps.reduce((sum, step) => sum + (step.l1DataFeeWei ?? 0n), 0n);
    if (!operatorUnavailable) operatorFeeWei = completeSteps.reduce((sum, step) => sum + (step.operatorFeeWei ?? 0n), 0n);
  }
  const baseComponentsComplete = route.chainId !== 8453 || (!l1Unavailable && !operatorUnavailable);
  const allCosts = allGas && usableFee && baseComponentsComplete;
  const status: GasCostStatus = allCosts ? 'current' : steps.some((step) => step.status === 'estimated') ? 'partial' : 'unavailable';
  const componentError = route.chainId === 8453
    ? [l1Unavailable ? 'Base L1 data fee unavailable' : '', operatorUnavailable ? 'Base operator fee unavailable' : '']
      .filter(Boolean).join('; ')
    : '';
  const error = 'feeError' in feeResult
    ? safeGasCostError(feeResult.feeError)
    : componentError || (fee?.stale ? 'gas oracle data is stale' : undefined) || steps.find((step) => step.error)?.error;
  return {
    routeKey,
    walletAddress: route.walletAddress,
    chainId: route.chainId,
    operation: route.operation,
    status,
    fetchedAt,
    validUntil,
    blockNumber,
    fee,
    steps: completeSteps,
    estimatedGasUnits,
    executionGasFeeWei,
    l1DataFeeWei,
    operatorFeeWei,
    nativeValueWei,
    layerZeroNativeFeeWei: bridgeQuoteFee(route, 'nativeFee'),
    layerZeroTokenFeeWei: bridgeQuoteFee(route, 'lzTokenFee'),
    totalNativeCostWei: allCosts && executionGasFeeWei !== undefined
      ? nativeValueWei + executionGasFeeWei + (l1DataFeeWei ?? 0n) + (operatorFeeWei ?? 0n)
      : undefined,
    totalNativeCostScope: route.chainId === 8453
      ? (allCosts ? 'execution-plus-l1-plus-operator-plus-value' : undefined)
      : (executionGasFeeWei === undefined ? undefined : 'execution-plus-value'),
    error,
  };
}

/** UI-facing strings are produced only for values proven by the snapshot. */
export function formatRouteGasCost(estimate: RouteGasCostEstimate): {
  estimatedGas?: string;
  gasFee?: string;
  totalCost?: string;
} {
  if (estimate.status === 'unavailable') return {};
  const gasAmount = estimate.executionGasFeeWei === undefined ? undefined : formatNativeCost(estimate.executionGasFeeWei);
  const totalAmount = estimate.totalNativeCostWei === undefined ? undefined : formatNativeCost(estimate.totalNativeCostWei);
  const isMaxFee = estimate.fee?.mode !== 'legacy';
  const gasFeeLabel = gasAmount === undefined ? undefined : `${gasAmount.unit}${isMaxFee ? ' (max)' : ''}`;
  const executionLabel = isMaxFee ? 'max execution' : 'execution fee';
  const totalLabel = totalAmount === undefined ? undefined : estimate.totalNativeCostScope === 'execution-plus-l1-plus-operator-plus-value'
    ? `${totalAmount.unit} (native value + ${executionLabel} + Base L1/operator fees)`
    : `${totalAmount.unit} (native value + ${executionLabel})`;
  return {
    ...(estimate.estimatedGasUnits === undefined ? {} : { estimatedGas: `${formatGasUnits(estimate.estimatedGasUnits)} gas` }),
    ...(gasAmount === undefined || gasFeeLabel === undefined ? {} : { gasFee: `${gasAmount.amount} ${gasFeeLabel}` }),
    ...(totalAmount === undefined || totalLabel === undefined ? {} : { totalCost: `${totalAmount.amount} ${totalLabel}` }),
  };
}

export interface GasCostCacheView {
  status: 'current' | 'refreshing' | 'unavailable';
  /** Only a fresh snapshot belongs in `current`. */
  current?: RouteGasCostEstimate;
  /** A stale snapshot may be retained for visual continuity only. */
  previous?: RouteGasCostEstimate;
}

export interface RouteGasCostCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

interface GasCacheInFlight {
  promise?: Promise<RouteGasCostEstimate>;
  globalGeneration: number;
  routeGeneration: number;
}

/**
 * Small account/chain/route-scoped cache. A stale value is exposed as
 * `previous`, never as `current`; callers can show it while a bounded refresh
 * is in flight without treating it as a current authorization fact.
 */
export class RouteGasCostCache {
  private readonly entries = new Map<string, RouteGasCostEstimate>();
  private readonly inFlight = new Map<string, GasCacheInFlight>();
  private readonly routeGenerations = new Map<string, number>();
  private generation = 0;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: RouteGasCostCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 32;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || this.maxEntries > 128) {
      throw new RangeError('gas cache maxEntries must be an integer between 1 and 128');
    }
    this.ttlMs = assertTimeout(options.ttlMs, DEFAULT_TTL_MS, MAX_TTL_MS, 'gas cache TTL');
    this.now = options.now ?? Date.now;
  }

  view(route: PlannedRoute): GasCostCacheView {
    const key = routeGasCostKey(route);
    const previous = this.entries.get(key);
    const current = previous && previous.validUntil > this.now() ? previous : undefined;
    if (current) return { status: 'current', current };
    if (this.inFlight.has(key)) return { status: 'refreshing', previous };
    return { status: 'unavailable', previous };
  }

  async refresh(route: PlannedRoute, options: Omit<EstimatePlannedRouteCostOptions, 'ttlMs' | 'now'> = {}): Promise<RouteGasCostEstimate> {
    const key = routeGasCostKey(route);
    const existing = this.inFlight.get(key)?.promise;
    if (existing) return existing;
    const globalGeneration = this.generation;
    const routeGeneration = this.routeGenerations.get(key) ?? 0;
    const token: GasCacheInFlight = { globalGeneration, routeGeneration };
    // Requests are shared by all consumers of this account/chain/route key.
    // A component unmount must not abort another consumer's shared request;
    // callers ignore the result after cleanup.
    const promise = estimatePlannedRouteCost(route, {
      ...options,
      signal: undefined,
      ttlMs: this.ttlMs,
      now: this.now,
    }).then((estimate) => {
      if (globalGeneration === this.generation && routeGeneration === (this.routeGenerations.get(key) ?? 0)) {
        this.entries.delete(key);
        this.entries.set(key, estimate);
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
      }
      return estimate;
    }).finally(() => {
      // Generation changes detach an old request during clear(). Comparing it
      // prevents its cleanup from deleting a newer request for this key.
      if (this.inFlight.get(key) === token) this.inFlight.delete(key);
    });
    token.promise = promise;
    this.inFlight.set(key, token);
    return promise;
  }

  clear(route?: PlannedRoute): void {
    if (route) {
      const key = routeGasCostKey(route);
      this.entries.delete(key);
      this.routeGenerations.set(key, (this.routeGenerations.get(key) ?? 0) + 1);
      // Detach the request so a subsequent refresh starts with the new route
      // state. The old request is allowed to finish, but generation prevents
      // it from repopulating this cache.
      this.inFlight.delete(key);
      return;
    }
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const routeGasCostCache = new RouteGasCostCache();

/** Never leak a private key or RPC credential through an error string. */
export function safeGasCostError(error: unknown): string {
  const value = errorText(error);
  if (/abort|cancel/i.test(value)) return 'Gas estimate cancelled';
  if (/timed out|timeout/i.test(value)) return 'Gas estimate timed out';
  if (/Base L1 data fee unavailable/i.test(value)) return 'Base L1 data fee unavailable';
  if (/Base operator fee unavailable/i.test(value)) return 'Base operator fee unavailable';
  return 'Gas estimate unavailable';
}
