/**
 * f(x) Protocol integration — REAL SDK, REAL CALLDATA, REAL SIMULATION.
 * (AUDIT.md P0-2/P0-3, PLAN.md W-07)
 *
 * Verified against @aladdindao/fx-sdk@1.0.5 on Ethereum mainnet:
 * - getPositions / increasePosition / reducePosition behave as typed.
 * - increasePosition returns ready-to-sign txs (ERC-20 approve + Router call).
 *   This integration requests native FxRoute routing only so every nested
 *   converter payload remains locally auditable before signing.
 *
 * Broadcasting remains gated: nothing in this module sends a transaction.
 * Execution requires the Privy Policy Engine (W-08) — see fx/execution.ts.
 */
import {
  FxSdk,
  type Market as SdkMarket,
  type PositionType,
  type PositionInfo,
} from "@aladdindao/fx-sdk";
import { createPublicClient, formatUnits, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { addRpcUrlOverrideToChain } from "@privy-io/chains";
import { ADDRESSES, type Market } from "@fxaeon/shared";

// ── Market mapping ──────────────────────────────────────────────────────────
// Internal markets are collateral-denominated ("wstETH" | "WBTC"); the SDK
// uses underlying markets ("ETH" | "BTC").
export function toSdkMarket(market: Market): SdkMarket {
  return market === "wstETH" ? "ETH" : "BTC";
}

export function collateralAddress(market: Market): `0x${string}` {
  return (market === "wstETH" ? ADDRESSES.WSTETH : ADDRESSES.WBTC) as `0x${string}`;
}

/** Token decimals of the collateral asset (wstETH: 18, WBTC: 8). */
export function collateralDecimals(market: Market): number {
  return market === "wstETH" ? 18 : 8;
}

// ── Clients ─────────────────────────────────────────────────────────────────
/**
 * Flashbots Protect "fast" RPC. Transactions sent here are submitted privately
 * to block builders (never the public mempool), which is what actually defends
 * against sandwich/front-running MEV. See core/broadcast.ts for the send path.
 */
export const FLASHBOTS_RPC = "https://rpc.flashbots.net/fast?originId=fxbot";

export function getChainForUser(mevProtection: "off" | "flashbots") {
  if (mevProtection === "flashbots") {
    return addRpcUrlOverrideToChain(mainnet, FLASHBOTS_RPC);
  }
  return mainnet;
}

function requireRpcUrl(): string {
  const url = process.env.ALCHEMY_RPC_URL;
  if (!url) throw new Error("ALCHEMY_RPC_URL is required for blockchain operations");
  return url;
}

export function createFxSdk(rpcUrl?: string): FxSdk {
  return new FxSdk({ chainId: 1, rpcUrl: rpcUrl ?? requireRpcUrl() });
}

export function createPublicClientForUser(mevProtection: "off" | "flashbots"): PublicClient {
  // Reads (simulation, fee history, receipts) ALWAYS go to the standard RPC —
  // the Flashbots Protect RPC submits txs privately and does not serve
  // historical reads. MEV protection is applied at BROADCAST time, not here:
  // broadcasts route through core/broadcast.ts which, when the user enabled
  // protection, signs via Privy and sends the raw tx to FLASHBOTS_RPC.
  void mevProtection;
  return createPublicClient({ chain: mainnet, transport: http(requireRpcUrl()) });
}

/** Map the stored user setting to the broadcast MEV mode. */
export function mevModeForUser(mevProtection: string): "off" | "flashbots" {
  // "on" was briefly persisted by an older Mini App settings endpoint.
  return mevProtection === "flashbots" || mevProtection === "on" ? "flashbots" : "off";
}

// ── Reads ───────────────────────────────────────────────────────────────────
export async function getPositions(
  sdk: FxSdk,
  userAddress: string,
  market: Market,
  type: PositionType
): Promise<PositionInfo[]> {
  return sdk.getPositions({ userAddress, market: toSdkMarket(market), type });
}

const POSITION_RISK_ABI = [
  {
    type: "function",
    name: "getPositionDebtRatio",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "debtRatio", type: "uint256" }],
  },
  {
    type: "function",
    name: "getRebalanceRatios",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "function",
    name: "getLiquidateRatios",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
] as const;

export interface PoolRiskThresholds {
  /** Debt ratio at which protocol rebalancing becomes eligible. */
  rebalanceDebtRatio: number;
  /** Debt ratio at which the position enters liquidation mode. */
  liquidationDebtRatio: number;
}

export function positionPoolAddress(
  market: Market,
  side: PositionType
): `0x${string}` {
  if (market === "wstETH") {
    return (side === "long" ? ADDRESSES.WSTETH_LONG_POOL : ADDRESSES.WSTETH_SHORT_POOL) as `0x${string}`;
  }
  return (side === "long" ? ADDRESSES.WBTC_LONG_POOL : ADDRESSES.WBTC_SHORT_POOL) as `0x${string}`;
}

function ratioFromWad(value: bigint, label: string): number {
  const ratio = Number(formatUnits(value, 18));
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error(`Invalid on-chain ${label}`);
  }
  return ratio;
}

/**
 * Read governance-adjustable risk lines from the selected pool. These values
 * must never be replaced with UI constants: the contracts can update them.
 */
export async function getPoolRiskThresholds(params: {
  client: Pick<PublicClient, "readContract">;
  market: Market;
  side: PositionType;
}): Promise<PoolRiskThresholds> {
  const address = positionPoolAddress(params.market, params.side);
  const [rebalance, liquidation] = await Promise.all([
    params.client.readContract({
      address,
      abi: POSITION_RISK_ABI,
      functionName: "getRebalanceRatios",
    }),
    params.client.readContract({
      address,
      abi: POSITION_RISK_ABI,
      functionName: "getLiquidateRatios",
    }),
  ]);
  const rebalanceDebtRatio = ratioFromWad(rebalance[0], "rebalance debt ratio");
  const liquidationDebtRatio = ratioFromWad(liquidation[0], "liquidation debt ratio");
  if (liquidationDebtRatio <= rebalanceDebtRatio) {
    throw new Error("Invalid on-chain risk threshold ordering");
  }
  return { rebalanceDebtRatio, liquidationDebtRatio };
}

/** Read the pool's exact, price-aware debt ratio for one position. */
export async function getPositionDebtRatio(params: {
  client: Pick<PublicClient, "readContract">;
  market: Market;
  side: PositionType;
  positionId: number;
}): Promise<number> {
  if (!Number.isSafeInteger(params.positionId) || params.positionId <= 0) {
    throw new RangeError("Position ID must be a positive safe integer");
  }
  const value = await params.client.readContract({
    address: positionPoolAddress(params.market, params.side),
    abi: POSITION_RISK_ABI,
    functionName: "getPositionDebtRatio",
    args: [BigInt(params.positionId)],
  });
  return ratioFromWad(value, "position debt ratio");
}

// ── Quotes (no broadcast) ───────────────────────────────────────────────────
export interface TradeTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

export interface TradeRoute {
  routeType: string;
  leverage: number;
  /** Execution price as a decimal string, straight from the SDK. */
  executionPrice: string;
  /**
   * Minimum output in output-token base units, straight from reducePosition.
   * Open/increase and leverage-adjustment routes do not expose this field.
   */
  minOut?: string;
  colls: string;
  debts: string;
  txs: TradeTx[];
}

export interface OpenPositionQuote {
  positionId: number;
  slippage: number;
  routes: TradeRoute[];
}

const WAD = 10n ** 18n;
const WSTETH_RATE_ABI = [
  {
    type: "function",
    name: "stEthPerToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Calculate the exact unit that fx-sdk@1.0.5 expects in reducePosition.amount.
 *
 * The SDK's request type only says "wei", but its implementation is
 * side-dependent:
 * - long: raw position collateral units (`PositionInfo.rawColls`)
 * - BTC short: raw position debt units (`PositionInfo.rawDebts`)
 * - wstETH short: debt normalized by the live wstETH/stETH rate
 *   (`rawDebts * rateRes / 1e18`)
 *
 * A full close is controlled by `isClosePosition`; v1.0.5 merely requires a
 * positive amount before its close branch replaces the amount-derived value.
 * We use `1n` as the smallest valid sentinel and perform no unnecessary rate
 * read for that path.
 */
export function calculateSdkReductionAmountWei(params: {
  market: Market;
  side: PositionType;
  rawCollateralWei: bigint;
  rawDebtWei: bigint;
  fractionBps: number;
  /** Required only for a partial wstETH short reduction. */
  wstEthRateWei?: bigint;
}): bigint {
  const {
    market,
    side,
    rawCollateralWei,
    rawDebtWei,
    fractionBps,
    wstEthRateWei,
  } = params;
  if (!Number.isInteger(fractionBps) || fractionBps <= 0 || fractionBps > 10_000) {
    throw new RangeError("Reduction fraction must be an integer from 1 to 10000 bps");
  }
  if (rawCollateralWei <= 0n) {
    throw new RangeError("Position collateral must be greater than zero");
  }

  // The SDK ignores the amount-derived calculation for a full close after
  // validating that amount > 0. Avoid a needless wstETH rate RPC in this path.
  if (fractionBps === 10_000) return 1n;

  let basisWei = rawCollateralWei;
  let amountWei: bigint;
  if (side === "short") {
    if (rawDebtWei <= 0n) {
      throw new RangeError("Position debt must be greater than zero");
    }
    const rateWei = market === "wstETH" ? wstEthRateWei : WAD;
    if (rateWei === undefined || rateWei <= 0n) {
      throw new RangeError("A positive wstETH rate is required for a partial short reduction");
    }
    // This mirrors fx-sdk Position.reducePosition exactly: it subtracts
    // `amount` from rawDebts * rateRes / 1e18 for short positions.
    const normalizedDebtNumerator = rawDebtWei * rateWei;
    basisWei = normalizedDebtNumerator / WAD;
    // Keep the rate precision until the final integer conversion. Flooring
    // before applying the fraction could understate the request by one wei.
    amountWei =
      (normalizedDebtNumerator * BigInt(fractionBps)) / (WAD * 10_000n);
  } else {
    amountWei = (basisWei * BigInt(fractionBps)) / 10_000n;
  }

  if (amountWei <= 0n || amountWei >= basisWei) {
    throw new RangeError("Reduction rounds to an invalid SDK amount");
  }
  return amountWei;
}

/**
 * Resolve the live wstETH rate when needed, then calculate the SDK amount.
 * Pass the same public client used for route simulation so quote and
 * simulation observe a consistent chain.
 */
export async function getSdkReductionAmountWei(params: {
  client: Pick<PublicClient, "readContract">;
  market: Market;
  side: PositionType;
  rawCollateralWei: bigint;
  rawDebtWei: bigint;
  fractionBps: number;
}): Promise<bigint> {
  let wstEthRateWei: bigint | undefined;
  if (params.side === "short" && params.market === "wstETH" && params.fractionBps < 10_000) {
    wstEthRateWei = await params.client.readContract({
      address: ADDRESSES.WSTETH,
      abi: WSTETH_RATE_ABI,
      functionName: "stEthPerToken",
    });
  }
  return calculateSdkReductionAmountWei({ ...params, wstEthRateWei });
}

function normalizeRoutes(
  routes: Array<{
    routeType: unknown;
    leverage: number;
    executionPrice: string;
    minOut?: unknown;
    colls: string;
    debts: string;
    txs: Array<{ to: string; data: `0x${string}`; value?: bigint }>;
  }>,
  requireMinOut = false
): TradeRoute[] {
  return routes.map((r) => {
    const routeType = String(r.routeType);
    if (routeType !== "FxRoute") {
      throw new Error(`SDK returned unpinned embedded route '${routeType}'`);
    }
    const minOut = typeof r.minOut === "string" && /^\d+$/.test(r.minOut)
      ? r.minOut
      : undefined;
    if (requireMinOut && (minOut === undefined || BigInt(minOut) <= 0n)) {
      throw new Error("SDK returned a reduction route without a valid minimum output");
    }
    return {
      routeType,
      leverage: r.leverage,
      executionPrice: r.executionPrice,
      ...(minOut === undefined ? {} : { minOut }),
      colls: r.colls,
      debts: r.debts,
      txs: r.txs.map((t) => ({
        to: t.to as `0x${string}`,
        data: t.data,
        value: t.value ?? 0n,
      })),
    };
  });
}

// The SDK also supports remote Odos/Velora payloads embedded inside an f(x)
// Router call. A compromised quote API could change that nested target without
// changing tx.to, so the delegated signer intentionally uses only the
// protocol-native MultiPathConverter route table. This explicit non-empty
// target list keeps SDK 1.0.5 on FxRoute v1 (it does not auto-add FxRoute 2).
type SdkRouteTarget = NonNullable<
  Parameters<FxSdk["increasePosition"]>[0]["targets"]
>[number];
const safeSdkRouteTargets = (): SdkRouteTarget[] => ["FxRoute" as SdkRouteTarget];

export async function quoteOpenPosition(params: {
  sdk: FxSdk;
  userAddress: string;
  market: Market;
  side: PositionType;
  leverage: number;
  /** Collateral amount in wei units of the input token (bigint ONLY). */
  amountWei: bigint;
  /** SDK-supported input token; defaults to the market collateral token. */
  inputTokenAddress?: `0x${string}`;
  /** Slippage tolerance in percent (e.g. 0.5). */
  slippagePercent: number;
  positionId?: number;
}): Promise<OpenPositionQuote> {
  const { sdk, userAddress, market, side, leverage, amountWei, slippagePercent } = params;
  const result = await sdk.increasePosition({
    market: toSdkMarket(market),
    type: side,
    positionId: params.positionId ?? 0,
    leverage,
    inputTokenAddress: (params.inputTokenAddress ?? collateralAddress(market)).toLowerCase(),
    amount: amountWei,
    slippage: slippagePercent,
    userAddress,
    targets: safeSdkRouteTargets(),
  });
  return {
    positionId: result.positionId,
    slippage: result.slippage,
    routes: normalizeRoutes(result.routes),
  };
}

export async function quoteClosePosition(params: {
  sdk: FxSdk;
  userAddress: string;
  market: Market;
  side: PositionType;
  positionId: number;
  /**
   * Exact side-dependent SDK unit. Percentage-based callers must obtain this
   * from getSdkReductionAmountWei; do not multiply short raw collateral.
   */
  amountWei: bigint;
  /** SDK-supported output token; defaults to the market collateral token. */
  outputTokenAddress?: `0x${string}`;
  slippagePercent: number;
  isClosePosition?: boolean;
}): Promise<OpenPositionQuote> {
  const { sdk, userAddress, market, side, positionId, amountWei, slippagePercent } = params;
  const result = await sdk.reducePosition({
    market: toSdkMarket(market),
    type: side,
    positionId,
    outputTokenAddress: (params.outputTokenAddress ?? collateralAddress(market)).toLowerCase(),
    amount: amountWei,
    slippage: slippagePercent,
    userAddress,
    isClosePosition: params.isClosePosition,
    targets: safeSdkRouteTargets(),
  });
  return {
    positionId: result.positionId,
    slippage: result.slippage,
    routes: normalizeRoutes(result.routes, true),
  };
}

/** Quote a leverage change for an existing, user-owned position. */
export async function quoteAdjustPositionLeverage(params: {
  sdk: FxSdk;
  userAddress: string;
  market: Market;
  side: PositionType;
  positionId: number;
  leverage: number;
  slippagePercent: number;
}): Promise<OpenPositionQuote> {
  const { sdk, userAddress, market, side, positionId, leverage, slippagePercent } = params;
  const result = await sdk.adjustPositionLeverage({
    market: toSdkMarket(market),
    type: side,
    positionId,
    leverage,
    slippage: slippagePercent,
    userAddress,
    targets: safeSdkRouteTargets(),
  });
  return {
    positionId: result.positionId,
    slippage: result.slippage,
    routes: normalizeRoutes(result.routes),
  };
}

// ── Simulation gate ─────────────────────────────────────────────────────────
export type SimulationResult =
  | { success: true; gasUsed: bigint[]; totalGas: bigint }
  | { success: false; error: string; failedTxIndex?: number };

/**
 * Simulates a route's txs IN ORDER with chained state via eth_simulateV1
 * (viem simulateCalls), so the Router call sees the effect of the approve.
 * Fails closed: any error (including RPCs without eth_simulateV1) returns
 * success: false — callers must never broadcast on a failed/unavailable sim.
 */
export async function simulateRoute(
  client: PublicClient,
  account: `0x${string}`,
  txs: TradeTx[]
): Promise<SimulationResult> {
  try {
    const { results } = await client.simulateCalls({
      account,
      calls: txs.map((t) => ({ to: t.to, data: t.data, value: t.value })),
    });
    const gasUsed: bigint[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== "success") {
        const reason =
          (r as { error?: { message?: string } }).error?.message ?? "execution reverted";
        return { success: false, error: reason, failedTxIndex: i };
      }
      gasUsed.push(r.gasUsed);
    }
    return { success: true, gasUsed, totalGas: gasUsed.reduce((a, b) => a + b, 0n) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `simulation unavailable: ${message}` };
  }
}

// ── Market data (informational only — never used for execution pricing) ────
async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function getPoolData() {
  const res = await fetchWithTimeout("https://yields.llama.fi/pools");
  const data = await res.json();
  return (data.data as Array<{ project: string }>).filter(
    (p) => p.project === "fx-protocol" || p.project === "f(x)"
  );
}

export async function getEthPrice() {
  const res = await fetchWithTimeout(
    `https://coins.llama.fi/prices/current/ethereum:${ADDRESSES.ETH}`
  );
  const data = await res.json();
  return data.coins[`ethereum:${ADDRESSES.ETH}`]?.price || 0;
}
