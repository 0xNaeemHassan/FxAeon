/**
 * fxSAVE (savings) + deposit-and-mint / repay wrappers around fx-sdk.
 *
 * Everything here returns executor-ready TradeTx[] lists and NEVER lets an
 * unexpected contract slip through: `assertKnownTargets` fails closed if the
 * SDK ever builds a tx to an address outside the audited allow-list (the same
 * set of verified f(x) contracts). Defense in depth: even though the user's
 * wallet is unrestricted, the bot itself refuses to broadcast elsewhere.
 */
import type { FxSdk } from "@aladdindao/fx-sdk";
import {
  BRIDGE_OFT_BY_TOKEN,
  CHAIN_ID_BASE,
  CHAIN_ID_ETHEREUM,
} from "@aladdindao/fx-sdk";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
} from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES, type Market } from "@fxaeon/shared";
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

// ── Cross-chain bridge (LayerZero V2 OFT) ────────────────────────────────────
//
// fx-sdk 1.0.5 ships getBridgeQuote / buildBridgeTx for moving fxUSD and fxSAVE
// between Ethereum (chainId 1) and Base (chainId 8453) via LayerZero V2 OFT
// adapters. Wrapped here in the same executor-ready shape + fail-closed target
// allow-list as the earn/mint/repay routes above.
//
// SCOPE — Ethereum → Base only: the W-11 executor signs, simulates and
// broadcasts on Ethereum mainnet, so an Ethereum→Base bridge (source chain =
// mainnet, a single OFT `send`) fits it exactly. Base→Ethereum would have to be
// signed/simulated on Base and is rejected here with an honest error.
//
// APPROVE — buildBridgeTx returns only the OFT `send` call. The fxUSD/fxSAVE OFT
// adapters are lockbox adapters (address ≠ token), so `send` pulls tokens via
// transferFrom and needs an ERC-20 allowance. quoteBridge reads the allowance
// and prepends an `approve` tx only when it is short.

export type BridgeToken = "fxUSD" | "fxSAVE";

/** Both bridgeable tokens are 18-decimal on Ethereum. */
export const BRIDGE_TOKEN_DECIMALS = 18;

/** Ethereum-side ERC-20 token address for each bridgeable asset. */
function bridgeTokenAddressEthereum(token: BridgeToken): `0x${string}` {
  return (token === "fxUSD" ? ADDRESSES.FXUSD : ADDRESSES.FXSAVE) as `0x${string}`;
}

/** Ethereum-side OFT adapter address (the `send` target / approve spender). */
export function oftAdapterEthereum(token: BridgeToken): `0x${string}` {
  return BRIDGE_OFT_BY_TOKEN[token][CHAIN_ID_ETHEREUM] as `0x${string}`;
}

/**
 * Contracts an Ethereum→Base bridge tx is ever allowed to target: the OFT
 * adapter (`send`) and the bridged token (`approve`). Fails closed otherwise.
 */
function assertKnownBridgeTargets(
  txs: SdkTx[],
  token: BridgeToken,
  action: string
): TradeTx[] {
  if (txs.length === 0) throw new Error(`${action}: no transactions built`);
  const allowed = new Set(
    [bridgeTokenAddressEthereum(token), oftAdapterEthereum(token)].map((a) => a.toLowerCase())
  );
  for (const tx of txs) {
    if (!allowed.has(tx.to.toLowerCase())) {
      throw new Error(
        `${action}: refusing to broadcast — built a tx to unexpected contract ${tx.to}`
      );
    }
  }
  return txs.map((t) => ({
    to: t.to as `0x${string}`,
    data: t.data as `0x${string}`,
    value: t.value ?? 0n,
  }));
}

/** Only Ethereum→Base is supported today; anything else throws an honest error. */
export function assertEthToBase(sourceChainId: number, destChainId: number): void {
  if (sourceChainId === CHAIN_ID_BASE && destChainId === CHAIN_ID_ETHEREUM) {
    throw new Error(
      "Base → Ethereum bridging isn't live yet — it has to be signed on Base, " +
        "which this bot's executor doesn't do. Ethereum → Base works today."
    );
  }
  if (sourceChainId !== CHAIN_ID_ETHEREUM || destChainId !== CHAIN_ID_BASE) {
    throw new Error("Only Ethereum → Base bridging is supported.");
  }
}

export interface BridgeQuote {
  /** LayerZero native gas fee (wei) — paid as the source tx value. */
  nativeFeeWei: bigint;
  /** OFT adapter the bridge sends through (Ethereum side). */
  oftAdapter: `0x${string}`;
}

/** Real on-chain LayerZero quote for an Ethereum→Base bridge. No tx is built. */
export async function quoteBridgeFee(params: {
  sdk: FxSdk;
  token: BridgeToken;
  /** Amount in wei (18 decimals). */
  amountWei: bigint;
  /** Recipient on Base (EOA / smart wallet — same address by default). */
  recipient: string;
}): Promise<BridgeQuote> {
  const { sdk, token, amountWei, recipient } = params;
  if (amountWei <= 0n) throw new Error("Bridge amount must be greater than 0.");
  if (!isAddress(recipient)) throw new Error("Recipient must be a valid address.");
  const quote = await sdk.getBridgeQuote({
    sourceChainId: CHAIN_ID_ETHEREUM,
    destChainId: CHAIN_ID_BASE,
    token,
    amount: amountWei,
    recipient,
    sourceRpcUrl: getConfig().ALCHEMY_RPC_URL,
  });
  return { nativeFeeWei: quote.nativeFee, oftAdapter: oftAdapterEthereum(token) };
}

/**
 * Executor-ready tx list for an Ethereum→Base bridge:
 *   [approve(token → OFT adapter)?, OFT.send{value: nativeFee}]
 * The approve is prepended only when the current allowance is short.
 */
export async function quoteBridge(params: {
  sdk: FxSdk;
  userAddress: `0x${string}`;
  token: BridgeToken;
  /** Amount in wei (18 decimals). */
  amountWei: bigint;
  /** Recipient on Base. Defaults to userAddress. */
  recipient?: `0x${string}`;
  /** Allowance reader override (tests). */
  readAllowance?: (
    token: `0x${string}`,
    owner: `0x${string}`,
    spender: `0x${string}`
  ) => Promise<bigint>;
}): Promise<{ txs: TradeTx[]; quote: BridgeQuote }> {
  const { sdk, userAddress, token, amountWei } = params;
  const recipient = params.recipient ?? userAddress;
  if (amountWei <= 0n) throw new Error("Bridge amount must be greater than 0.");

  const tokenAddr = bridgeTokenAddressEthereum(token);
  const adapter = oftAdapterEthereum(token);

  const built = await sdk.buildBridgeTx({
    sourceChainId: CHAIN_ID_ETHEREUM,
    destChainId: CHAIN_ID_BASE,
    token,
    amount: amountWei,
    recipient,
    refundAddress: userAddress,
    sourceRpcUrl: getConfig().ALCHEMY_RPC_URL,
  });

  // OFT lockbox adapter pulls the token via transferFrom → ensure allowance.
  const readAllowance =
    params.readAllowance ??
    ((t, owner, spender) =>
      readClient().readContract({
        address: t,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, spender],
      }));
  const allowance = await readAllowance(tokenAddr, userAddress, adapter);

  const raw: SdkTx[] = [];
  if (allowance < amountWei) {
    raw.push({
      to: tokenAddr,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [adapter, amountWei],
      }),
      value: 0n,
    });
  }
  raw.push({ to: built.tx.to, data: built.tx.data, value: built.tx.value });

  return {
    txs: assertKnownBridgeTargets(raw, token, "bridge"),
    quote: { nativeFeeWei: built.quote.nativeFee, oftAdapter: adapter },
  };
}
