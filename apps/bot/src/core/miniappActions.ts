/**
 * Unified server-side action engine for the phone Mini App.
 *
 * The client submits intent parameters only. This module validates them,
 * resolves ownership and balances from chain state, asks the official f(x)
 * SDK for fresh calldata, simulates the ordered route, and only then lets the
 * existing transaction executor sign/broadcast it. Client calldata, gas, token
 * addresses, wallet addresses and position ownership are never trusted.
 */
import { randomBytes } from "node:crypto";
import { prisma, Prisma } from "@fxaeon/db";
import { formatUnits, isAddress, parseUnits } from "viem";
import {
  MARKETS,
  PROTOCOL_TOKENS,
  RISK_PARAMS,
  isProtocolTokenSymbol,
  type Market,
  type ProtocolTokenSymbol,
} from "@fxaeon/shared";
import {
  createFxSdk,
  createPublicClientForUser,
  getSdkReductionAmountWei,
  getPositions,
  mevModeForUser,
  quoteAdjustPositionLeverage,
  quoteClosePosition,
  quoteOpenPosition,
  simulateRoute,
  type TradeTx,
} from "../fx/index.js";
import {
  bridgeChainName,
  bridgeTokenAddress,
  createBridgePublicClient,
  getSaveClaimable,
  quoteBridge,
  oftAdapterForChain,
  quoteDepositAndMint,
  quoteRepay,
  quoteSaveClaim,
  quoteSaveDeposit,
  quoteSaveWithdraw,
  type BridgeToken,
  type SaveToken,
} from "../fx/earn.js";
import { requireDelegatedWallet, type DelegationGateUser } from "./delegation.js";
import { executeRoute } from "./txExecutor.js";
import { getEip1559FeeTiers, type FeeTierKey } from "./fees.js";
import {
  buildGasEstimate,
  readTradeReceipt,
  routeGasLimitWithHeadroom,
  type GasEstimate,
  type TradeReceiptInfo,
} from "./actionPresentation.js";
import { getSpotPrices } from "../market/coingecko.js";
import { describeExecutionError } from "./errorTaxonomy.js";
import { botLogger } from "../middleware/logger.js";
import { features } from "../middleware/config.js";
import { assertRouteAllowed } from "./signerPolicy.js";

type Side = "long" | "short";

export type MiniActionParams =
  | {
      kind: "position_open";
      market: Market;
      side: Side;
      inputToken: ProtocolTokenSymbol;
      amount: string;
      leverage: number;
    }
  | {
      kind: "position_increase";
      market: Market;
      side: Side;
      positionId: number;
      inputToken: ProtocolTokenSymbol;
      amount: string;
    }
  | {
      kind: "position_reduce";
      market: Market;
      side: Side;
      positionId: number;
      outputToken: ProtocolTokenSymbol;
      fractionBps: number;
    }
  | {
      kind: "position_adjust";
      market: Market;
      side: Side;
      positionId: number;
      leverage: number;
    }
  | {
      kind: "mint";
      market: Market;
      positionId: number;
      depositToken: ProtocolTokenSymbol;
      depositAmount: string;
      mintAmount: string;
    }
  | {
      kind: "repay_withdraw";
      market: Market;
      positionId: number;
      repayAmount: string | "all";
      withdrawToken: ProtocolTokenSymbol;
      withdrawAmount: string;
    }
  | {
      kind: "save_deposit";
      tokenIn: "USDC" | "fxUSD" | "fxUSDBasePool";
      amount: string;
    }
  | {
      kind: "save_withdraw";
      tokenOut: "USDC" | "fxUSD" | "fxUSDBasePool";
      shares: string | "all";
      instant: boolean;
    }
  | { kind: "save_claim" }
  | {
      kind: "bridge";
      token: BridgeToken;
      amount: string;
      direction: "ethereum_to_base" | "base_to_ethereum";
    };

export type ActionValidation =
  | { ok: true; params: MiniActionParams }
  | { ok: false; code: string; message: string };

const KINDS = new Set<MiniActionParams["kind"]>([
  "position_open",
  "position_increase",
  "position_reduce",
  "position_adjust",
  "mint",
  "repay_withdraw",
  "save_deposit",
  "save_withdraw",
  "save_claim",
  "bridge",
]);

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function marketOf(value: unknown): Market | null {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value)
    ? (value as Market)
    : null;
}

function sideOf(value: unknown): Side | null {
  return value === "long" || value === "short" ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function strictDecimal(value: unknown, decimals: number): string | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const pattern = new RegExp(`^(?:\\d+(?:\\.\\d{1,${decimals}})?|\\.\\d{1,${decimals}})$`);
  if (!pattern.test(value)) return null;
  try {
    return parseUnits(value, decimals) > 0n ? value : null;
  } catch {
    return null;
  }
}

function nonNegativeDecimal(value: unknown, decimals: number): string | null {
  if (value === "0") return "0";
  return strictDecimal(value, decimals);
}

function compatiblePositionToken(
  value: unknown,
  market: Market,
  output: boolean
): ProtocolTokenSymbol | null {
  if (!isProtocolTokenSymbol(value)) return null;
  const token = PROTOCOL_TOKENS[value];
  if (!token.positionMarkets.includes(market)) return null;
  // SDK excludes stETH as a short-position output even though it accepts it as input.
  if (output && market === "wstETH" && value === "stETH") return null;
  return value;
}

function leverageOf(value: unknown, side: Side): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const max = side === "long" ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
  return value >= RISK_PARAMS.MIN_LEVERAGE && value <= max ? value : null;
}

export function validateMiniActionBody(body: unknown): ActionValidation {
  const b = recordOf(body);
  const kind = b.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as MiniActionParams["kind"])) {
    return { ok: false, code: "BAD_ACTION", message: "Choose a supported f(x) action." };
  }
  if (kind === "save_claim") return { ok: true, params: { kind } };

  if (kind === "bridge") {
    const token = b.token === "fxUSD" || b.token === "fxSAVE" ? b.token : null;
    const amount = strictDecimal(b.amount, 18);
    const direction = b.direction === "base_to_ethereum" ? "base_to_ethereum" : b.direction === "ethereum_to_base" ? "ethereum_to_base" : null;
    if (!token || !amount || !direction) return { ok: false, code: "BAD_BRIDGE", message: "Choose a supported route, fxUSD or fxSAVE, and enter a positive amount." };
    return { ok: true, params: { kind, token, amount, direction } };
  }

  if (kind === "save_deposit") {
    const tokenIn = b.tokenIn === "USDC" || b.tokenIn === "fxUSD" || b.tokenIn === "fxUSDBasePool" ? b.tokenIn : null;
    const amount = tokenIn ? strictDecimal(b.amount, PROTOCOL_TOKENS[tokenIn].decimals) : null;
    if (!tokenIn || !amount) return { ok: false, code: "BAD_SAVE_DEPOSIT", message: "Choose a supported deposit token and positive amount." };
    return { ok: true, params: { kind, tokenIn, amount } };
  }

  if (kind === "save_withdraw") {
    const tokenOut = b.tokenOut === "USDC" || b.tokenOut === "fxUSD" || b.tokenOut === "fxUSDBasePool" ? b.tokenOut : null;
    const shares = b.shares === "all" ? "all" : strictDecimal(b.shares, 18);
    const instant = b.instant === true;
    if (!tokenOut || !shares || (tokenOut === "fxUSDBasePool" && instant)) {
      return { ok: false, code: "BAD_SAVE_WITHDRAW", message: "Choose a valid withdrawal token, share amount and mode." };
    }
    return { ok: true, params: { kind, tokenOut, shares, instant } };
  }

  const market = marketOf(b.market);
  if (!market) return { ok: false, code: "BAD_MARKET", message: "Choose wstETH or WBTC." };

  if (kind === "mint") {
    const positionId = b.positionId === 0 ? 0 : positiveInt(b.positionId);
    const depositToken = isProtocolTokenSymbol(b.depositToken) ? b.depositToken : null;
    const allowed = market === "wstETH"
      ? new Set<ProtocolTokenSymbol>(["ETH", "WETH", "stETH", "wstETH"])
      : new Set<ProtocolTokenSymbol>(["WBTC"]);
    const depositAmount = depositToken ? strictDecimal(b.depositAmount, PROTOCOL_TOKENS[depositToken].decimals) : null;
    const mintAmount = strictDecimal(b.mintAmount, 18);
    if (positionId === null || !depositToken || !allowed.has(depositToken) || !depositAmount || !mintAmount) {
      return { ok: false, code: "BAD_MINT", message: "Enter a valid collateral deposit and fxUSD mint amount." };
    }
    return { ok: true, params: { kind, market, positionId, depositToken, depositAmount, mintAmount } };
  }

  if (kind === "repay_withdraw") {
    const positionId = positiveInt(b.positionId);
    const repayAmount = b.repayAmount === "all" ? "all" : nonNegativeDecimal(b.repayAmount, 18);
    const withdrawToken = isProtocolTokenSymbol(b.withdrawToken) ? b.withdrawToken : null;
    const allowed = market === "wstETH"
      ? new Set<ProtocolTokenSymbol>(["ETH", "WETH", "stETH", "wstETH"])
      : new Set<ProtocolTokenSymbol>(["WBTC"]);
    const withdrawAmount = withdrawToken === null
      ? null
      : b.withdrawAmount === "0"
        ? "0"
        : strictDecimal(b.withdrawAmount, PROTOCOL_TOKENS[withdrawToken].decimals);
    if (
      !positionId ||
      !repayAmount ||
      !withdrawToken ||
      !allowed.has(withdrawToken) ||
      withdrawAmount === null ||
      (repayAmount === "0" && withdrawAmount === "0")
    ) {
      return { ok: false, code: "BAD_REPAY", message: "Enter a valid debt repayment and optional collateral withdrawal." };
    }
    return { ok: true, params: { kind, market, positionId, repayAmount, withdrawToken, withdrawAmount } };
  }

  const side = sideOf(b.side);
  if (!side) return { ok: false, code: "BAD_SIDE", message: "Choose long or short." };

  if (kind === "position_open") {
    const inputToken = compatiblePositionToken(b.inputToken, market, false);
    const amount = inputToken ? strictDecimal(b.amount, PROTOCOL_TOKENS[inputToken].decimals) : null;
    const leverage = leverageOf(b.leverage, side);
    if (!inputToken || !amount || !leverage) return { ok: false, code: "BAD_OPEN", message: "Check the token, amount and leverage." };
    return { ok: true, params: { kind, market, side, inputToken, amount, leverage } };
  }

  const positionId = positiveInt(b.positionId);
  if (!positionId) return { ok: false, code: "BAD_POSITION", message: "Choose a valid position." };

  if (kind === "position_increase") {
    const inputToken = compatiblePositionToken(b.inputToken, market, false);
    const amount = inputToken ? strictDecimal(b.amount, PROTOCOL_TOKENS[inputToken].decimals) : null;
    if (!inputToken || !amount) return { ok: false, code: "BAD_INCREASE", message: "Choose a supported token and positive amount." };
    return { ok: true, params: { kind, market, side, positionId, inputToken, amount } };
  }
  if (kind === "position_reduce") {
    const outputToken = compatiblePositionToken(b.outputToken, market, true);
    const fractionBps = typeof b.fractionBps === "number" && Number.isInteger(b.fractionBps) && b.fractionBps >= 100 && b.fractionBps <= 10_000
      ? b.fractionBps
      : null;
    if (!outputToken || !fractionBps) return { ok: false, code: "BAD_REDUCE", message: "Choose an output token and reduction from 1% to 100%." };
    return { ok: true, params: { kind, market, side, positionId, outputToken, fractionBps } };
  }
  const leverage = leverageOf(b.leverage, side);
  if (!leverage) return { ok: false, code: "BAD_LEVERAGE", message: "Choose leverage inside the market limit." };
  return { ok: true, params: { kind: "position_adjust", market, side, positionId, leverage } };
}

export interface ActionDetail {
  label: string;
  value: string;
}

interface BuiltAction {
  title: string;
  description: string;
  txType: string;
  txs: TradeTx[];
  details: ActionDetail[];
  warning?: string;
  chainId?: 1 | 8453;
  intentScopedBridge?: {
    sourceChainId: 1 | 8453;
    tokenAddress: `0x${string}`;
    oftTarget: `0x${string}`;
    amount: bigint;
  };
}

export interface MiniActionQuote {
  kind: MiniActionParams["kind"];
  title: string;
  description: string;
  network: "Ethereum" | "Base";
  chainId: 1 | 8453;
  details: ActionDetail[];
  warning?: string;
  mevProtection: "on" | "off";
  gas: GasEstimate;
  /** Opaque, short-lived handle for the exact calldata simulated above. */
  ticket: string;
  expiresAt: string;
}

export interface MiniActionUser extends DelegationGateUser {
  id: string;
  walletAddress: string;
  slippageBps: number;
  mevProtection: string;
}

export const MINI_ACTION_TICKET_TTL_MS = 2 * 60 * 1000;

interface FrozenActionPlan {
  version: 2;
  kind: MiniActionParams["kind"];
  params: MiniActionParams;
  walletAddress: string;
  txType: string;
  chainId: 1 | 8453;
  txs: Array<{ to: string; data: string; value: string }>;
  /** Per-tier worst-case network fee displayed during this exact review. */
  maxFeeCostWei: Record<FeeTierKey, string>;
  intentScopedBridge?: {
    sourceChainId: 1 | 8453;
    tokenAddress: string;
    oftTarget: string;
    amount: string;
  };
}

function freezeActionPlan(
  user: MiniActionUser,
  params: MiniActionParams,
  action: BuiltAction,
  chainId: 1 | 8453,
  maxFeeCostWei: Record<FeeTierKey, string>
): FrozenActionPlan {
  return {
    version: 2,
    kind: params.kind,
    params,
    walletAddress: user.walletAddress.toLowerCase(),
    txType: action.txType,
    chainId,
    txs: action.txs.map((tx) => ({
      to: tx.to,
      data: tx.data,
      value: tx.value.toString(),
    })),
    maxFeeCostWei,
    intentScopedBridge: action.intentScopedBridge
      ? {
          sourceChainId: action.intentScopedBridge.sourceChainId,
          tokenAddress: action.intentScopedBridge.tokenAddress,
          oftTarget: action.intentScopedBridge.oftTarget,
          amount: action.intentScopedBridge.amount.toString(),
        }
      : undefined,
  };
}

function parseFrozenActionPlan(value: unknown, user: MiniActionUser): FrozenActionPlan | null {
  const plan = recordOf(value);
  const validated = validateMiniActionBody(plan.params);
  if (
    plan.version !== 2 ||
    !validated.ok ||
    plan.kind !== validated.params.kind ||
    plan.walletAddress !== user.walletAddress.toLowerCase() ||
    (plan.chainId !== 1 && plan.chainId !== 8453) ||
    typeof plan.txType !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(plan.txType) ||
    !Array.isArray(plan.txs) ||
    plan.txs.length < 1 ||
    plan.txs.length > 3
  ) return null;

  const rawFeeCosts = recordOf(plan.maxFeeCostWei);
  const maxFeeCostWei = {} as Record<FeeTierKey, string>;
  for (const tier of ["slow", "market", "fast"] as const) {
    const value = rawFeeCosts[tier];
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    maxFeeCostWei[tier] = value;
  }

  const txs: FrozenActionPlan["txs"] = [];
  for (const raw of plan.txs) {
    const tx = recordOf(raw);
    if (
      typeof tx.to !== "string" ||
      !isAddress(tx.to) ||
      typeof tx.data !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data) ||
      typeof tx.value !== "string" ||
      !/^\d+$/.test(tx.value)
    ) return null;
    txs.push({ to: tx.to, data: tx.data, value: tx.value });
  }

  let intentScopedBridge: FrozenActionPlan["intentScopedBridge"];
  if (plan.intentScopedBridge !== undefined) {
    const scope = recordOf(plan.intentScopedBridge);
    if (
      (scope.sourceChainId !== 1 && scope.sourceChainId !== 8453) ||
      scope.sourceChainId !== plan.chainId ||
      typeof scope.tokenAddress !== "string" ||
      !isAddress(scope.tokenAddress) ||
      typeof scope.oftTarget !== "string" ||
      !isAddress(scope.oftTarget) ||
      typeof scope.amount !== "string" ||
      !/^[1-9]\d*$/.test(scope.amount)
    ) return null;
    intentScopedBridge = {
      sourceChainId: scope.sourceChainId,
      tokenAddress: scope.tokenAddress,
      oftTarget: scope.oftTarget,
      amount: scope.amount,
    };
  }
  if ((validated.params.kind === "bridge") !== Boolean(intentScopedBridge)) return null;

  return {
    version: 2,
    kind: validated.params.kind,
    params: validated.params,
    walletAddress: plan.walletAddress,
    txType: plan.txType,
    chainId: plan.chainId,
    txs,
    maxFeeCostWei,
    intentScopedBridge,
  };
}

async function ownedPosition(
  sdk: ReturnType<typeof createFxSdk>,
  userAddress: string,
  market: Market,
  side: Side,
  positionId: number
) {
  const positions = await getPositions(sdk, userAddress, market, side);
  const position = positions.find((p) => p.positionId === positionId && p.rawColls > 0n);
  if (!position) throw new Error(`Position #${positionId} was not found in this wallet.`);
  return position;
}

function saveTokenKey(symbol: "USDC" | "fxUSD" | "fxUSDBasePool"): SaveToken {
  return symbol === "USDC" ? "usdc" : symbol;
}

async function buildAction(user: MiniActionUser, params: MiniActionParams): Promise<BuiltAction> {
  const sdk = createFxSdk();
  const slippage = user.slippageBps / 100;

  if (params.kind === "position_open") {
    const token = PROTOCOL_TOKENS[params.inputToken];
    const quote = await quoteOpenPosition({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      side: params.side,
      leverage: params.leverage,
      amountWei: parseUnits(params.amount, token.decimals),
      inputTokenAddress: token.address,
      slippagePercent: slippage,
    });
    const route = quote.routes[0];
    if (!route) throw new Error("No route is available for this position.");
    return {
      title: `Open ${params.market} ${params.side}`,
      description: "Create a new leveraged position",
      txType: params.side === "long" ? "open_long" : "open_short",
      txs: route.txs,
      details: [
        { label: "Pay", value: `${params.amount} ${params.inputToken}` },
        { label: "Leverage", value: `${params.leverage}×` },
        { label: "Execution price", value: route.executionPrice },
        { label: "Route", value: route.routeType },
      ],
      warning: "Leveraged positions can be liquidated. Review size, leverage and slippage before confirming.",
    };
  }

  if (params.kind === "position_increase") {
    const position = await ownedPosition(sdk, user.walletAddress, params.market, params.side, params.positionId);
    const token = PROTOCOL_TOKENS[params.inputToken];
    const quote = await quoteOpenPosition({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      side: params.side,
      positionId: params.positionId,
      leverage: position.currentLeverage,
      amountWei: parseUnits(params.amount, token.decimals),
      inputTokenAddress: token.address,
      slippagePercent: slippage,
    });
    const route = quote.routes[0];
    if (!route) throw new Error("No increase route is available.");
    return {
      title: `Add to ${params.market} ${params.side} #${params.positionId}`,
      description: "Increase an existing position",
      txType: "increase_position",
      txs: route.txs,
      details: [
        { label: "Add", value: `${params.amount} ${params.inputToken}` },
        { label: "Leverage before", value: `${position.currentLeverage.toFixed(2)}×` },
        { label: "Leverage after", value: `${route.leverage.toFixed(2)}×` },
        {
          label: "Collateral after",
          value: `${formatUnits(BigInt(route.colls), position.rawCollsDecimals)} ${position.rawCollsToken}`,
        },
        {
          label: "Debt after",
          value: `${formatUnits(BigInt(route.debts), position.rawDebtsDecimals)} ${position.rawDebtsToken}`,
        },
        { label: "Execution price", value: route.executionPrice },
      ],
      warning: "Adding capital changes exposure and liquidation risk.",
    };
  }

  if (params.kind === "position_reduce") {
    const position = await ownedPosition(sdk, user.walletAddress, params.market, params.side, params.positionId);
    const amountWei = await getSdkReductionAmountWei({
      client: createPublicClientForUser(mevModeForUser(user.mevProtection)),
      market: params.market,
      side: params.side,
      rawCollateralWei: position.rawColls,
      rawDebtWei: position.rawDebts,
      fractionBps: params.fractionBps,
    });
    if (amountWei <= 0n) throw new Error("This reduction is too small for the position.");
    const token = PROTOCOL_TOKENS[params.outputToken];
    const quote = await quoteClosePosition({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      side: params.side,
      positionId: params.positionId,
      amountWei,
      outputTokenAddress: token.address,
      slippagePercent: slippage,
      isClosePosition: params.fractionBps === 10_000,
    });
    const route = quote.routes[0];
    if (!route) throw new Error("No reduction route is available.");
    return {
      title: `${params.fractionBps === 10_000 ? "Close" : "Reduce"} ${params.market} ${params.side} #${params.positionId}`,
      description: params.fractionBps === 10_000 ? "Close the entire position" : "Reduce position exposure",
      txType: params.fractionBps === 10_000 ? "close_position" : "reduce_position",
      txs: route.txs,
      details: [
        { label: "Reduction", value: `${params.fractionBps / 100}%` },
        { label: "Receive as", value: params.outputToken },
        {
          label: "Minimum output",
          value: `${formatUnits(BigInt(route.minOut!), token.decimals)} ${params.outputToken}`,
        },
      ],
    };
  }

  if (params.kind === "position_adjust") {
    const position = await ownedPosition(sdk, user.walletAddress, params.market, params.side, params.positionId);
    if (Math.abs(position.currentLeverage - params.leverage) < 0.01) throw new Error("The position is already at that leverage.");
    const quote = await quoteAdjustPositionLeverage({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      side: params.side,
      positionId: params.positionId,
      leverage: params.leverage,
      slippagePercent: slippage,
    });
    const route = quote.routes[0];
    if (!route) throw new Error("No leverage-adjustment route is available.");
    return {
      title: `Adjust ${params.market} ${params.side} #${params.positionId}`,
      description: "Change position leverage",
      txType: "adjust_leverage",
      txs: route.txs,
      details: [
        { label: "Current", value: `${position.currentLeverage.toFixed(2)}×` },
        { label: "Target", value: `${params.leverage}×` },
        { label: "Route", value: route.routeType },
      ],
      warning: params.leverage > position.currentLeverage ? "Higher leverage moves the position closer to liquidation." : undefined,
    };
  }

  if (params.kind === "mint") {
    if (params.positionId > 0) await ownedPosition(sdk, user.walletAddress, params.market, "long", params.positionId);
    const token = PROTOCOL_TOKENS[params.depositToken];
    const quote = await quoteDepositAndMint({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      positionId: params.positionId,
      depositTokenAddress: token.address,
      collateralWei: parseUnits(params.depositAmount, token.decimals),
      mintWei: parseUnits(params.mintAmount, 18),
    });
    return {
      title: `Mint ${params.mintAmount} fxUSD`,
      description: params.positionId === 0 ? "Open a collateralized borrowing position" : `Add to borrowing position #${params.positionId}`,
      txType: "mint",
      txs: quote.txs,
      details: [
        { label: "Deposit", value: `${params.depositAmount} ${params.depositToken}` },
        { label: "Mint", value: `${params.mintAmount} fxUSD` },
        { label: "Market", value: params.market },
        { label: "Resulting leverage", value: `${quote.leverage.toFixed(2)}×` },
        {
          label: "Collateral after",
          value: `${formatUnits(BigInt(quote.colls), params.market === "WBTC" ? 8 : 18)} ${params.market}`,
        },
        { label: "Debt after", value: `${formatUnits(BigInt(quote.debts), 18)} fxUSD` },
        { label: "Execution price", value: quote.executionPrice },
      ],
      warning: "Minting creates debt backed by collateral. Falling collateral value can cause liquidation.",
    };
  }

  if (params.kind === "repay_withdraw") {
    const position = await ownedPosition(sdk, user.walletAddress, params.market, "long", params.positionId);
    let repayWei = params.repayAmount === "all" ? position.rawDebts : parseUnits(params.repayAmount, 18);
    if (repayWei > position.rawDebts) repayWei = position.rawDebts;
    const token = PROTOCOL_TOKENS[params.withdrawToken];
    const withdrawWei = params.withdrawAmount === "0" ? 0n : parseUnits(params.withdrawAmount, token.decimals);
    if (repayWei <= 0n && withdrawWei <= 0n) throw new Error("Enter a repayment or withdrawal amount.");
    const quote = await quoteRepay({
      sdk,
      userAddress: user.walletAddress,
      market: params.market,
      positionId: params.positionId,
      repayWei,
      withdrawWei,
      withdrawTokenAddress: token.address,
    });
    return {
      title: `Manage debt #${params.positionId}`,
      description: "Repay fxUSD and optionally withdraw collateral",
      txType: "repay_withdraw",
      txs: quote.txs,
      details: [
        { label: "Repay", value: `${formatUnits(repayWei, 18)} fxUSD` },
        { label: "Withdraw", value: `${params.withdrawAmount} ${params.withdrawToken}` },
        { label: "Debt before", value: `${formatUnits(position.rawDebts, position.rawDebtsDecimals)} fxUSD` },
        { label: "Resulting leverage", value: `${quote.leverage.toFixed(2)}×` },
        {
          label: "Collateral after",
          value: `${formatUnits(BigInt(quote.colls), position.rawCollsDecimals)} ${position.rawCollsToken}`,
        },
        {
          label: "Debt after",
          value: `${formatUnits(BigInt(quote.debts), position.rawDebtsDecimals)} ${position.rawDebtsToken}`,
        },
        { label: "Execution price", value: quote.executionPrice },
      ],
    };
  }

  if (params.kind === "save_deposit") {
    const token = PROTOCOL_TOKENS[params.tokenIn];
    const txs = await quoteSaveDeposit({
      sdk,
      userAddress: user.walletAddress,
      tokenIn: saveTokenKey(params.tokenIn),
      amountWei: parseUnits(params.amount, token.decimals),
      slippagePercent: slippage,
    });
    return {
      title: "Deposit into fxSAVE",
      description: "Receive yield-bearing fxSAVE shares",
      txType: "fxsave_deposit",
      txs,
      details: [
        { label: "Deposit", value: `${params.amount} ${params.tokenIn}` },
        { label: "Destination", value: "fxSAVE Stability Pool" },
      ],
    };
  }

  if (params.kind === "save_withdraw") {
    const directBasePool = params.tokenOut === "fxUSDBasePool";
    const balance = await sdk.getFxSaveBalance({ userAddress: user.walletAddress });
    const sharesWei = params.shares === "all" ? balance.balanceWei : parseUnits(params.shares, 18);
    if (sharesWei <= 0n || sharesWei > balance.balanceWei) throw new Error("The requested shares exceed this wallet's fxSAVE balance.");
    const txs = await quoteSaveWithdraw({
      sdk,
      userAddress: user.walletAddress,
      sharesWei,
      instant: params.instant,
      tokenOut: saveTokenKey(params.tokenOut),
      slippagePercent: slippage,
    });
    return {
      title: directBasePool
        ? "Direct fxSAVE base-pool redemption"
        : `${params.instant ? "Instant" : "Queued"} fxSAVE withdrawal`,
      description: directBasePool
        ? "Redeem immediately into the fxUSD base-pool token"
        : params.instant
          ? "Exit immediately with the protocol fee"
          : "Start the cooldown, then claim when ready",
      txType: "fxsave_withdraw",
      txs,
      details: [
        { label: "Shares", value: formatUnits(sharesWei, 18) },
        { label: "Receive", value: params.tokenOut },
        {
          label: "Mode",
          value: directBasePool ? "Direct vault redeem" : params.instant ? "Instant swap" : "Cooldown queue",
        },
      ],
    };
  }

  if (params.kind === "save_claim") {
    const status = await getSaveClaimable(sdk, user.walletAddress);
    if (!status.hasPendingRedeem) throw new Error("There is no pending redemption to claim.");
    if (!status.isCooldownComplete) throw new Error("The redemption cooldown is not complete yet.");
    const txs = await quoteSaveClaim(sdk, user.walletAddress);
    return {
      title: "Claim fxSAVE redemption",
      description: "Receive assets from a matured withdrawal",
      txType: "fxsave_claim",
      txs,
      details: [
        { label: "Pending shares", value: status.pendingShares },
        { label: "fxUSD preview", value: status.previewFxUsd ?? "Unavailable" },
        { label: "USDC preview", value: status.previewUsdc ?? "Unavailable" },
      ],
    };
  }

  const amountWei = parseUnits(params.amount, 18);
  const sourceChainId = params.direction === "ethereum_to_base" ? 1 : 8453;
  const destChainId = sourceChainId === 1 ? 8453 : 1;
  const built = await quoteBridge({
    userAddress: user.walletAddress as `0x${string}`,
    token: params.token,
    amountWei,
    sourceChainId,
    destChainId,
  });
  const sourceName = bridgeChainName(sourceChainId);
  const destName = bridgeChainName(destChainId);
  return {
    title: `Bridge ${params.token} to ${destName}`,
    description: `LayerZero V2 transfer from ${sourceName} to ${destName}`,
    txType: sourceChainId === 1 ? "bridge_eth_to_base" : "bridge_base_to_eth",
    txs: built.txs,
    details: [
      { label: "Send", value: `${params.amount} ${params.token}` },
      { label: "Route", value: `${sourceName} → ${destName}` },
      { label: "LayerZero fee", value: `${formatUnits(built.quote.nativeFeeWei, 18)} ETH` },
      { label: "Recipient", value: `Same wallet on ${destName}` },
    ],
    chainId: sourceChainId,
    intentScopedBridge: {
      sourceChainId,
      tokenAddress: bridgeTokenAddress(params.token, sourceChainId),
      oftTarget: oftAdapterForChain(params.token, sourceChainId),
      amount: amountWei,
    },
  };
}

export async function buildMiniActionQuote(
  user: MiniActionUser,
  params: MiniActionParams
): Promise<MiniActionQuote> {
  if (params.kind === "bridge" && !features.enableBridgeExecution) {
    throw new Error("Bridge execution is paused by the operator.");
  }
  const action = await buildAction(user, params);
  const chainId = action.chainId ?? 1;
  assertRouteAllowed(action.txs, {
    walletAddress: user.walletAddress,
    chainId,
    intentScopedBridge: action.intentScopedBridge,
    mode: "enforce",
  });
  const client = chainId === 8453
    ? createBridgePublicClient(8453)
    : createPublicClientForUser(mevModeForUser(user.mevProtection));
  const simulation = await simulateRoute(client, user.walletAddress as `0x${string}`, action.txs);
  if (!simulation.success) throw new Error(`This action would fail on-chain: ${simulation.error}`);
  const tiers = await getEip1559FeeTiers(client);
  let ethPrice: number | null = null;
  try {
    const prices = await getSpotPrices();
    if (!prices.stale) ethPrice = prices.prices.ETH ?? null;
  } catch {
    // USD gas stays unknown; the wei/ETH estimate remains exact.
  }
  // Show and freeze the actual maximum gas limits used by the executor (the
  // per-step estimates plus 20% headroom), not the lower raw estimate.
  const gasUnitsWithHeadroom = routeGasLimitWithHeadroom(simulation.gasUsed);
  const gas = buildGasEstimate(gasUnitsWithHeadroom, tiers, ethPrice);
  const maxFeeCostWei = Object.fromEntries(
    gas.tiers.map((tier) => [tier.key, tier.estCostWei])
  ) as Record<FeeTierKey, string>;
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MINI_ACTION_TICKET_TTL_MS);
  const frozen = freezeActionPlan(user, params, action, chainId, maxFeeCostWei);
  await prisma.actionQuoteTicket.create({
    data: {
      id: ticket,
      userId: user.id,
      walletAddress: user.walletAddress.toLowerCase(),
      actionKind: params.kind,
      data: frozen as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
  });
  try {
    await prisma.actionQuoteTicket.deleteMany({
      where: { expiresAt: { lte: new Date() }, id: { not: ticket } },
    });
  } catch (error) {
    botLogger.debug({ error: String(error) }, "miniapp action: expired ticket cleanup skipped");
  }
  return {
    kind: params.kind,
    title: action.title,
    description: action.description,
    network: bridgeChainName(chainId),
    chainId,
    details: action.details,
    warning: action.warning,
    mevProtection:
      chainId === 1 && mevModeForUser(user.mevProtection) === "flashbots" ? "on" : "off",
    gas,
    ticket,
    expiresAt: expiresAt.toISOString(),
  };
}

export type MiniActionExecuteResult =
  | {
      ok: true;
      deduped: boolean;
      status: string;
      txHash: string | null;
      hashes: string[];
      recordId: string;
      receipt: TradeReceiptInfo | null;
      chainId: 1 | 8453;
      message?: string;
    }
  | { ok: false; code: string; message: string };

export async function executeMiniAction(
  user: MiniActionUser,
  ticketId: string,
  feeTier: FeeTierKey
): Promise<MiniActionExecuteResult> {
  const ticket = await prisma.actionQuoteTicket.findUnique({ where: { id: ticketId } });
  if (
    !ticket ||
    ticket.userId !== user.id ||
    ticket.walletAddress.toLowerCase() !== user.walletAddress.toLowerCase()
  ) {
    return { ok: false, code: "QUOTE_TICKET_INVALID", message: "This review does not belong to the authenticated wallet. Prepare a fresh quote." };
  }
  if (ticket.expiresAt.getTime() <= Date.now()) {
    return { ok: false, code: "QUOTE_TICKET_EXPIRED", message: "This live quote expired. Review the action again before confirming." };
  }
  const plan = parseFrozenActionPlan(ticket.data, user);
  if (!plan || plan.kind !== ticket.actionKind) {
    return { ok: false, code: "QUOTE_TICKET_INVALID", message: "The reviewed transaction plan is invalid. Prepare a fresh quote." };
  }
  if (plan.kind === "bridge" && !features.enableBridgeExecution) {
    return {
      ok: false,
      code: "BRIDGE_EXECUTION_DISABLED",
      message: "Bridge execution is paused by the operator. No transaction was sent.",
    };
  }
  const gate = await requireDelegatedWallet(user);
  if (!gate.ok) return { ok: false, code: "BOT_TRADING_OFF", message: gate.message };
  try {
    // Claim the ticket before any fee/RPC/broadcast work. A replay may still
    // enter this path, but its immutable server id is also the executor's
    // idempotency key, so it can only observe/dedupe the same transaction.
    const claimed = await prisma.actionQuoteTicket.updateMany({
      where: {
        id: ticket.id,
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      // A replay of a previously consumed immutable ticket is safe: the same
      // ticket id is the executor idempotency key and can only observe the
      // original route. An unconsumed ticket that lost the atomic claim has
      // expired or been invalidated and must never reach signing.
      const latest = await prisma.actionQuoteTicket.findUnique({ where: { id: ticket.id } });
      if (!latest?.consumedAt) {
        return {
          ok: false,
          code: latest && latest.expiresAt.getTime() <= Date.now()
            ? "QUOTE_TICKET_EXPIRED"
            : "QUOTE_TICKET_INVALID",
          message: "This live review is no longer executable. Prepare a fresh quote.",
        };
      }
    }

    const chainId = plan.chainId;
    const client = chainId === 8453
      ? createBridgePublicClient(8453)
      : createPublicClientForUser(mevModeForUser(user.mevProtection));
    const txs: TradeTx[] = plan.txs.map((tx) => ({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value),
    }));
    const result = await executeRoute({
      userId: user.id,
      walletId: gate.walletId,
      walletAddress: user.walletAddress as `0x${string}`,
      idempotencyKey: `miniapp-action:${user.id}:${ticket.id}`,
      txs,
      type: plan.txType,
      client,
      chainId,
      intentScopedBridge: plan.intentScopedBridge
        ? {
            sourceChainId: chainId,
            tokenAddress: plan.intentScopedBridge.tokenAddress as `0x${string}`,
            oftTarget: plan.intentScopedBridge.oftTarget as `0x${string}`,
            amount: BigInt(plan.intentScopedBridge.amount),
          }
        : undefined,
      mev: chainId === 8453 ? "off" : mevModeForUser(user.mevProtection),
      feeTier,
      maxTotalFeeWei: BigInt(plan.maxFeeCostWei[feeTier]),
    });
    if (!result.ok) {
      // Once any hash exists, this is an on-chain outcome—not a preflight
      // error. Return the durable journal state so the phone can show pending,
      // partial, cancelled, or reverted honestly and link every landed step.
      const record = await prisma.txRecord.findFirst({
        where: { id: result.recordId, userId: user.id },
        select: { hash: true, data: true },
      });
      const persistedHashes = (record?.data as { hashes?: unknown } | null)?.hashes;
      const hashes = Array.isArray(persistedHashes)
        ? persistedHashes.filter((value): value is string => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value))
        : [];
      if (hashes.length > 0 || record?.hash) {
        const txHash = record?.hash ?? hashes.at(-1) ?? null;
        return {
          ok: true,
          deduped: result.deduped,
          status: result.status,
          txHash,
          hashes,
          recordId: result.recordId,
          receipt: null,
          chainId,
          message: describeExecutionError(result.error),
        };
      }
      return { ok: false, code: "EXECUTION_FAILED", message: describeExecutionError(result.error) };
    }
    const txHash = result.hashes.at(-1) ?? null;
    let receipt: TradeReceiptInfo | null = null;
    if (txHash && result.status === "confirmed") {
      let ethPrice: number | null = null;
      try {
        const prices = await getSpotPrices();
        if (!prices.stale) ethPrice = prices.prices.ETH ?? null;
      } catch {
        // Receipt stays useful without a USD conversion.
      }
      receipt = await readTradeReceipt(client as never, txHash, ethPrice);
    }
    return {
      ok: true,
      deduped: result.deduped,
      status: result.status,
      txHash,
      hashes: result.hashes,
      recordId: result.recordId,
      receipt,
      chainId,
    };
  } catch (error) {
    botLogger.warn({ error: String(error), kind: plan.kind, ticketId }, "miniapp action failed before broadcast");
    return {
      ok: false,
      code: "ACTION_FAILED",
      message: "The action could not be prepared or simulated. Check balances and live position state, then try again. Nothing was sent.",
    };
  }
}
