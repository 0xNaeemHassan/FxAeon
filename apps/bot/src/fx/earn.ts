/**
 * fxSAVE (savings) + deposit-and-mint / repay wrappers around fx-sdk.
 *
 * Everything here returns executor-ready TradeTx[] lists and NEVER lets an
 * unexpected contract slip through: `assertKnownTargets` fails closed if the
 * SDK ever builds a tx to an address outside the audited allow-list (the same
 * set the Privy wallet policy allows — see core/walletPolicy.ts). Defense in
 * depth: even if the policy were too permissive, the bot refuses to broadcast.
 */
import type { FxSdk } from "@aladdindao/fx-sdk";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES, type Market } from "@fxbot/shared";
import { getConfig } from "../middleware/config.js";
import { collateralAddress, toSdkMarket, type TradeTx } from "./index.js";

/**
 * Contracts a save/mint/repay tx is ever allowed to target.
 * Token addresses are included because ERC20 approves are txs TO the token.
 */
const KNOWN_TARGETS: ReadonlySet<string> = new Set(
  [
    ADDRESSES.ROUTER,
    ADDRESSES.FXSAVE,
    ADDRESSES.FX_MINT_ROUTER,
    ADDRESSES.FXUSD,
    ADDRESSES.USDC,
    ADDRESSES.WSTETH,
    ADDRESSES.WBTC,
    ADDRESSES.STETH,
  ].map((a) => a.toLowerCase())
);

interface SdkTx {
  to: string;
  data: string;
  value?: bigint;
}

export function assertKnownTargets(txs: SdkTx[], action: string): TradeTx[] {
  if (txs.length === 0) throw new Error(`${action}: SDK returned no transactions`);
  for (const tx of txs) {
    if (!KNOWN_TARGETS.has(tx.to.toLowerCase())) {
      throw new Error(
        `${action}: refusing to broadcast — SDK built a tx to unexpected contract ${tx.to}`
      );
    }
  }
  return txs.map((t) => ({
    to: t.to as `0x${string}`,
    data: t.data as `0x${string}`,
    value: t.value ?? 0n,
  }));
}

// ── Balance reads ───────────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 8_000;

function readClient() {
  const cfg = getConfig();
  return createPublicClient({
    chain: mainnet,
    transport: http(cfg.ALCHEMY_RPC_URL, { timeout: RPC_TIMEOUT_MS }),
  });
}

export async function erc20Balance(token: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
  return readClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

// ── fxSAVE overview (reads only, fail-soft per field) ───────────────────────

export interface SaveOverview {
  /** fxSAVE share balance (18 decimals), formatted. */
  shares: string;
  sharesWei: bigint;
  /** Underlying assets value if available (18 decimals), formatted. */
  assets: string | null;
  /** Wallet fxUSD / USDC balances, formatted. */
  fxUsd: string;
  usdc: string;
  redeem: {
    hasPendingRedeem: boolean;
    pendingShares: string;
    redeemableAt: number | null;
    isCooldownComplete: boolean;
    cooldownHours: number;
  };
}

export async function getSaveOverview(sdk: FxSdk, userAddress: string): Promise<SaveOverview> {
  const addr = userAddress as `0x${string}`;
  const [balance, redeem, fxUsdWei, usdcWei] = await Promise.all([
    sdk.getFxSaveBalance({ userAddress }),
    sdk.getFxSaveRedeemStatus({ userAddress }),
    erc20Balance(ADDRESSES.FXUSD as `0x${string}`, addr),
    erc20Balance(ADDRESSES.USDC as `0x${string}`, addr),
  ]);
  return {
    shares: formatUnits(balance.balanceWei, 18),
    sharesWei: balance.balanceWei,
    assets: balance.assetsWei !== undefined ? formatUnits(balance.assetsWei, 18) : null,
    fxUsd: formatUnits(fxUsdWei, 18),
    usdc: formatUnits(usdcWei, 6),
    redeem: {
      hasPendingRedeem: redeem.hasPendingRedeem,
      pendingShares: formatUnits(redeem.pendingSharesWei, 18),
      redeemableAt: redeem.redeemableAt,
      isCooldownComplete: redeem.isCooldownComplete,
      cooldownHours: Number(redeem.cooldownPeriodSeconds) / 3600,
    },
  };
}

// ── fxSAVE quotes ───────────────────────────────────────────────────────────

export type SaveToken = "fxUSD" | "usdc";

export async function quoteSaveDeposit(params: {
  sdk: FxSdk;
  userAddress: string;
  tokenIn: SaveToken;
  /** Amount in wei of tokenIn (fxUSD 18 dec, USDC 6 dec). */
  amountWei: bigint;
  slippagePercent: number;
}): Promise<TradeTx[]> {
  const { txs } = await params.sdk.depositFxSave({
    userAddress: params.userAddress,
    tokenIn: params.tokenIn,
    amount: params.amountWei,
    slippage: params.slippagePercent,
  });
  return assertKnownTargets(txs, "fxSAVE deposit");
}

export async function quoteSaveWithdraw(params: {
  sdk: FxSdk;
  userAddress: string;
  /** fxSAVE shares in wei (18 decimals). */
  sharesWei: bigint;
  /** true = instant (fee + slippage), false = 2-step cooldown request. */
  instant: boolean;
  slippagePercent: number;
}): Promise<TradeTx[]> {
  const { txs } = await params.sdk.withdrawFxSave({
    userAddress: params.userAddress,
    tokenOut: "fxUSD",
    amount: params.sharesWei,
    instant: params.instant,
    slippage: params.instant ? params.slippagePercent : undefined,
  });
  return assertKnownTargets(txs, "fxSAVE withdraw");
}

export interface SaveClaimable {
  hasPendingRedeem: boolean;
  isCooldownComplete: boolean;
  redeemableAt: number | null;
  pendingShares: string;
  previewFxUsd: string | null;
  previewUsdc: string | null;
}

export async function getSaveClaimable(sdk: FxSdk, userAddress: string): Promise<SaveClaimable> {
  const c = await sdk.getFxSaveClaimable({ userAddress });
  return {
    hasPendingRedeem: c.hasPendingRedeem,
    isCooldownComplete: c.isCooldownComplete,
    redeemableAt: c.redeemableAt,
    pendingShares: formatUnits(c.pendingSharesWei, 18),
    previewFxUsd: c.previewReceive ? formatUnits(c.previewReceive.amountYieldOutWei, 18) : null,
    previewUsdc: c.previewReceive ? formatUnits(c.previewReceive.amountStableOutWei, 6) : null,
  };
}

export async function quoteSaveClaim(sdk: FxSdk, userAddress: string): Promise<TradeTx[]> {
  const { txs } = await sdk.getRedeemTx({ userAddress });
  return assertKnownTargets(txs, "fxSAVE claim");
}

// ── Deposit & mint / repay (FxMintRouter) ───────────────────────────────────

export interface MintQuote {
  positionId: number;
  executionPrice: string;
  txs: TradeTx[];
}

export async function quoteDepositAndMint(params: {
  sdk: FxSdk;
  userAddress: string;
  market: Market;
  /** Collateral amount in wei of the market's collateral token. */
  collateralWei: bigint;
  /** fxUSD to mint, in wei (18 decimals). */
  mintWei: bigint;
  /** 0 = new position, >0 = add to existing. */
  positionId?: number;
}): Promise<MintQuote> {
  const result = await params.sdk.depositAndMint({
    market: toSdkMarket(params.market),
    positionId: params.positionId ?? 0,
    userAddress: params.userAddress,
    // SDK compares this address case-sensitively against its lowercase
    // registry — keep it lowercase or it rejects with "must be eth, stETH…".
    depositTokenAddress: collateralAddress(params.market).toLowerCase(),
    depositAmount: params.collateralWei,
    mintAmount: params.mintWei,
  });
  return {
    positionId: result.positionId,
    executionPrice: result.executionPrice,
    txs: assertKnownTargets(result.txs as SdkTx[], "deposit & mint"),
  };
}

export async function quoteRepay(params: {
  sdk: FxSdk;
  userAddress: string;
  market: Market;
  positionId: number;
  /** fxUSD to repay, in wei (18 decimals). */
  repayWei: bigint;
  /** Collateral to withdraw alongside, in wei (0 = repay only). */
  withdrawWei?: bigint;
}): Promise<TradeTx[]> {
  const result = await params.sdk.repayAndWithdraw({
    market: toSdkMarket(params.market),
    positionId: params.positionId,
    userAddress: params.userAddress,
    repayAmount: params.repayWei,
    withdrawAmount: params.withdrawWei ?? 0n,
    withdrawTokenAddress: collateralAddress(params.market).toLowerCase(),
  });
  return assertKnownTargets(result.txs as SdkTx[], "repay");
}
