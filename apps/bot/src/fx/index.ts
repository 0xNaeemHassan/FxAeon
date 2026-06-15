/**
 * f(x) Protocol integration — REAL SDK, REAL CALLDATA, REAL SIMULATION.
 * (AUDIT.md P0-2/P0-3, PLAN.md W-07)
 *
 * Verified against @aladdindao/fx-sdk@1.0.5 on Ethereum mainnet:
 * - getPositions / increasePosition / reducePosition behave as typed.
 * - increasePosition returns ready-to-sign txs (ERC-20 approve + Router call)
 *   routed via Odos / Velora / FxRoute; the Router target matches the
 *   verified ADDRESSES.ROUTER.
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
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { addRpcUrlOverrideToChain } from "@privy-io/chains";
import { ADDRESSES, type Market } from "@fxbot/shared";

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
  return mevProtection === "flashbots" ? "flashbots" : "off";
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
  colls: string;
  debts: string;
  txs: TradeTx[];
}

export interface OpenPositionQuote {
  positionId: number;
  slippage: number;
  routes: TradeRoute[];
}

function normalizeRoutes(
  routes: Array<{
    routeType: unknown;
    leverage: number;
    executionPrice: string;
    colls: string;
    debts: string;
    txs: Array<{ to: string; data: `0x${string}`; value?: bigint }>;
  }>
): TradeRoute[] {
  return routes.map((r) => ({
    routeType: String(r.routeType),
    leverage: r.leverage,
    executionPrice: r.executionPrice,
    colls: r.colls,
    debts: r.debts,
    txs: r.txs.map((t) => ({
      to: t.to as `0x${string}`,
      data: t.data,
      value: t.value ?? 0n,
    })),
  }));
}

export async function quoteOpenPosition(params: {
  sdk: FxSdk;
  userAddress: string;
  market: Market;
  side: PositionType;
  leverage: number;
  /** Collateral amount in wei units of the input token (bigint ONLY). */
  amountWei: bigint;
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
    inputTokenAddress: collateralAddress(market),
    amount: amountWei,
    slippage: slippagePercent,
    userAddress,
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
  amountWei: bigint;
  slippagePercent: number;
  isClosePosition?: boolean;
}): Promise<OpenPositionQuote> {
  const { sdk, userAddress, market, side, positionId, amountWei, slippagePercent } = params;
  const result = await sdk.reducePosition({
    market: toSdkMarket(market),
    type: side,
    positionId,
    outputTokenAddress: collateralAddress(market),
    amount: amountWei,
    slippage: slippagePercent,
    userAddress,
    isClosePosition: params.isClosePosition,
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
