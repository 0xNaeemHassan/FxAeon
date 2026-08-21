/**
 * fxSAVE (savings) + deposit-and-mint / repay wrappers around fx-sdk.
 *
 * Everything here returns executor-ready TradeTx[] lists and NEVER lets an
 * unexpected contract slip through: `assertKnownTargets` fails closed if the
 * SDK ever builds a tx to an address outside the audited allow-list (the same
 * set of verified f(x) contracts). Defense in depth: even though the user's
 * wallet is unrestricted, the bot itself refuses to broadcast elsewhere.
 */
import {
  BRIDGE_OFT_BY_TOKEN,
  CHAIN_ID_BASE,
  CHAIN_ID_ETHEREUM,
  FxSdk,
  type SupportedBridgeChainId,
} from "@aladdindao/fx-sdk";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  type PublicClient,
} from "viem";
import { base, mainnet } from "viem/chains";
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
    ADDRESSES.FXUSD_BASE_POOL,
    ADDRESSES.FX_MINT_ROUTER,
    ADDRESSES.FXUSD,
    ADDRESSES.USDC,
    ADDRESSES.USDT,
    ADDRESSES.WETH,
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

export interface SaveConfig {
  totalSupply: string;
  totalAssets: string;
  assetsPerShare: number | null;
  cooldownHours: number;
  instantRedeemFeePct: number;
  expenseRatioPct: number;
  harvesterRatioPct: number;
  threshold: string;
}

/** Live fxSAVE protocol totals and parameters from the SDK. */
export async function getSaveConfig(sdk: FxSdk): Promise<SaveConfig> {
  const config = await sdk.getFxSaveConfig();
  const totalSupply = formatUnits(config.totalSupplyWei, 18);
  const totalAssets = formatUnits(config.totalAssetsWei, 18);
  const ratioToPct = (value: bigint): number => Number(formatUnits(value, 18)) * 100;
  return {
    totalSupply,
    totalAssets,
    assetsPerShare: config.totalSupplyWei > 0n
      ? Number((config.totalAssetsWei * 1_000_000_000n) / config.totalSupplyWei) / 1_000_000_000
      : null,
    cooldownHours: Number(config.cooldownPeriodSeconds) / 3600,
    instantRedeemFeePct: ratioToPct(config.instantRedeemFeeRatio),
    expenseRatioPct: ratioToPct(config.expenseRatio),
    harvesterRatioPct: ratioToPct(config.harvesterRatio),
    threshold: formatUnits(config.threshold, 18),
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

export type SaveToken = "fxUSD" | "usdc" | "fxUSDBasePool";

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
  /** true = instant (fee + slippage), false = 2-step cooldown request.
   * fxUSDBasePool is a third SDK mode: direct ERC-4626 redeem, immediately. */
  instant: boolean;
  slippagePercent: number;
  /** Every tokenOut accepted by fx-sdk. Defaults to fxUSD. */
  tokenOut?: SaveToken;
}): Promise<TradeTx[]> {
  const tokenOut = params.tokenOut ?? "fxUSD";
  const { txs } = await params.sdk.withdrawFxSave({
    userAddress: params.userAddress,
    tokenOut,
    amount: params.sharesWei,
    // SDK 1.0.5 special-cases fxUSDBasePool before checking `instant`; false
    // documents that this is neither its fee-bearing instant swap nor queue.
    instant: tokenOut === "fxUSDBasePool" ? false : params.instant,
    slippage:
      tokenOut !== "fxUSDBasePool" && params.instant ? params.slippagePercent : undefined,
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
  leverage: number;
  executionPrice: string;
  colls: string;
  debts: string;
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
  /** Any deposit token accepted by the SDK for this market. */
  depositTokenAddress?: `0x${string}`;
  /** 0 = new position, >0 = add to existing. */
  positionId?: number;
}): Promise<MintQuote> {
  const result = await params.sdk.depositAndMint({
    market: toSdkMarket(params.market),
    positionId: params.positionId ?? 0,
    userAddress: params.userAddress,
    // SDK compares this address case-sensitively against its lowercase
    // registry — keep it lowercase or it rejects with "must be eth, stETH…".
    depositTokenAddress: (params.depositTokenAddress ?? collateralAddress(params.market)).toLowerCase(),
    depositAmount: params.collateralWei,
    mintAmount: params.mintWei,
  });
  return {
    positionId: result.positionId,
    leverage: result.leverage,
    executionPrice: result.executionPrice,
    colls: result.colls,
    debts: result.debts,
    txs: assertKnownTargets(result.txs as SdkTx[], "deposit & mint"),
  };
}

export interface RepayQuote {
  positionId: number;
  leverage: number;
  executionPrice: string;
  colls: string;
  debts: string;
  txs: TradeTx[];
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
  /** Any withdraw token accepted by the SDK for this market. */
  withdrawTokenAddress?: `0x${string}`;
}): Promise<RepayQuote> {
  const result = await params.sdk.repayAndWithdraw({
    market: toSdkMarket(params.market),
    positionId: params.positionId,
    userAddress: params.userAddress,
    repayAmount: params.repayWei,
    withdrawAmount: params.withdrawWei ?? 0n,
    withdrawTokenAddress: (params.withdrawTokenAddress ?? collateralAddress(params.market)).toLowerCase(),
  });
  return {
    positionId: result.positionId,
    leverage: result.leverage,
    executionPrice: result.executionPrice,
    colls: result.colls,
    debts: result.debts,
    txs: assertKnownTargets(result.txs as SdkTx[], "repay"),
  };
}

// ── Cross-chain bridge (LayerZero V2 OFT) ────────────────────────────────────
//
// fx-sdk 1.0.5 ships getBridgeQuote / buildBridgeTx for moving fxUSD and fxSAVE
// between Ethereum (chainId 1) and Base (chainId 8453) via LayerZero V2 OFT
// adapters. Wrapped here in the same executor-ready shape + fail-closed target
// allow-list as the earn/mint/repay routes above.
//
// SCOPE — both Ethereum → Base and Base → Ethereum. The caller must construct
// the matching source-chain public client and pass the same chainId to the
// executor; helpers below make that pairing explicit.
//
// APPROVE — buildBridgeTx returns only the OFT `send` call. The fxUSD/fxSAVE OFT
// Ethereum adapters are lockboxes (address ≠ token), so `send` pulls tokens via
// transferFrom and may need an approval. On Base the child token is itself the
// OFT and burns directly, so no approval is built.

export type BridgeToken = "fxUSD" | "fxSAVE";
export type BridgeChainId = SupportedBridgeChainId;

export interface BridgeRoute {
  sourceChainId: BridgeChainId;
  destChainId: BridgeChainId;
}

/** Both bridgeable tokens are 18-decimal on Ethereum. */
export const BRIDGE_TOKEN_DECIMALS = 18;
/** SDK 1.0.5 truncates destination credit to four token decimals. */
export const BRIDGE_MIN_AMOUNT_WEI = 10n ** 14n;

function assertBridgeAmount(amountWei: bigint): void {
  if (amountWei < BRIDGE_MIN_AMOUNT_WEI) {
    throw new Error("Bridge amount must be at least 0.0001 token (the SDK credit granularity).");
  }
}

/** Validate and normalize either supported bridge direction. */
export function resolveBridgeRoute(
  sourceChainId: number = CHAIN_ID_ETHEREUM,
  destChainId?: number
): BridgeRoute {
  if (sourceChainId !== CHAIN_ID_ETHEREUM && sourceChainId !== CHAIN_ID_BASE) {
    throw new Error(`Unsupported bridge source chainId ${sourceChainId}; use 1 or 8453.`);
  }
  const resolvedDest =
    destChainId ??
    (sourceChainId === CHAIN_ID_ETHEREUM ? CHAIN_ID_BASE : CHAIN_ID_ETHEREUM);
  if (resolvedDest !== CHAIN_ID_ETHEREUM && resolvedDest !== CHAIN_ID_BASE) {
    throw new Error(`Unsupported bridge destination chainId ${resolvedDest}; use 1 or 8453.`);
  }
  if (sourceChainId === resolvedDest) {
    throw new Error("Bridge source and destination chains must differ.");
  }
  return { sourceChainId, destChainId: resolvedDest };
}

export function bridgeChainName(chainId: BridgeChainId): "Ethereum" | "Base" {
  return chainId === CHAIN_ID_ETHEREUM ? "Ethereum" : "Base";
}

/** Configured source-chain RPC; never silently executes over a public fallback. */
export function bridgeRpcUrl(chainId: BridgeChainId): string {
  const cfg = getConfig();
  const url = chainId === CHAIN_ID_ETHEREUM ? cfg.ALCHEMY_RPC_URL : cfg.BASE_RPC_URL;
  if (!url) {
    const key = chainId === CHAIN_ID_ETHEREUM ? "ALCHEMY_RPC_URL" : "BASE_RPC_URL";
    throw new Error(`${key} is required for ${bridgeChainName(chainId)} bridge operations.`);
  }
  return url;
}

/** A source-chain SDK instance for bridge quote/build calls. */
export function createBridgeSdk(chainId: BridgeChainId): FxSdk {
  return new FxSdk({ chainId, rpcUrl: bridgeRpcUrl(chainId) });
}

/** Public client to pass to executeRoute for simulation/fees/receipt polling. */
export function createBridgePublicClient(chainId: BridgeChainId): PublicClient {
  const chain = chainId === CHAIN_ID_ETHEREUM ? mainnet : base;
  return createPublicClient({
    chain,
    transport: http(bridgeRpcUrl(chainId), { timeout: RPC_TIMEOUT_MS }),
  }) as PublicClient;
}

export interface BridgeBalanceSnapshot {
  chainId: BridgeChainId;
  known: true;
  /** Source-chain native gas balance, formatted with 18 decimals. */
  native: string;
  assets: {
    fxUSD: string;
    fxSAVE: string;
  };
}

/**
 * Read the wallet's bridgeable source assets and native gas on one chain.
 * The caller owns fail-soft behavior so an unavailable Base RPC can never be
 * confused with a real zero balance.
 */
export async function getBridgeBalances(
  userAddress: `0x${string}`,
  chainId: BridgeChainId
): Promise<BridgeBalanceSnapshot> {
  if (!isAddress(userAddress)) throw new Error("Bridge wallet must be a valid address.");
  const client = createBridgePublicClient(chainId);
  const [nativeWei, fxUsdWei, fxSaveWei] = await Promise.all([
    client.getBalance({ address: userAddress }),
    client.readContract({
      address: bridgeTokenAddress("fxUSD", chainId),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [userAddress],
    }),
    client.readContract({
      address: bridgeTokenAddress("fxSAVE", chainId),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [userAddress],
    }),
  ]);
  return {
    chainId,
    known: true,
    native: formatUnits(nativeWei, 18),
    assets: {
      fxUSD: formatUnits(fxUsdWei, 18),
      fxSAVE: formatUnits(fxSaveWei, 18),
    },
  };
}

/** Source-side OFT / adapter that receives the LayerZero `send` call. */
export function oftAdapterForChain(
  token: BridgeToken,
  chainId: BridgeChainId
): `0x${string}` {
  return BRIDGE_OFT_BY_TOKEN[token][chainId] as `0x${string}`;
}

/** Ethereum-side ERC-20 token address for each bridgeable asset. */
export function bridgeTokenAddress(
  token: BridgeToken,
  chainId: BridgeChainId
): `0x${string}` {
  if (chainId === CHAIN_ID_BASE) return oftAdapterForChain(token, chainId);
  return (token === "fxUSD" ? ADDRESSES.FXUSD : ADDRESSES.FXSAVE) as `0x${string}`;
}

/** Ethereum-side OFT adapter address (the `send` target / approve spender). */
export function oftAdapterEthereum(token: BridgeToken): `0x${string}` {
  return oftAdapterForChain(token, CHAIN_ID_ETHEREUM);
}

/**
 * Contracts an Ethereum→Base bridge tx is ever allowed to target: the OFT
 * adapter (`send`) and the bridged token (`approve`). Fails closed otherwise.
 */
function assertKnownBridgeTargets(
  txs: SdkTx[],
  token: BridgeToken,
  sourceChainId: BridgeChainId,
  action: string
): TradeTx[] {
  if (txs.length === 0) throw new Error(`${action}: no transactions built`);
  const allowed = new Set(
    [bridgeTokenAddress(token, sourceChainId), oftAdapterForChain(token, sourceChainId)].map((a) =>
      a.toLowerCase()
    )
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

/** Legacy guard retained for the Telegram command's Ethereum-only intent. */
export function assertEthToBase(sourceChainId: number, destChainId: number): void {
  resolveBridgeRoute(sourceChainId, destChainId);
  if (sourceChainId !== CHAIN_ID_ETHEREUM || destChainId !== CHAIN_ID_BASE) {
    throw new Error("This legacy flow only supports Ethereum -> Base.");
  }
}

export interface BridgeQuote {
  /** LayerZero native gas fee (wei) — paid as the source tx value. */
  nativeFeeWei: bigint;
  lzTokenFeeWei: bigint;
  sourceChainId: BridgeChainId;
  destChainId: BridgeChainId;
  /** Source-side OFT/adapter through which the bridge sends. */
  oftAdapter: `0x${string}`;
}

/** Real source-chain LayerZero quote. No transaction is built or signed. */
export async function quoteBridgeFee(params: {
  sdk?: FxSdk;
  token: BridgeToken;
  /** Amount in wei (18 decimals). */
  amountWei: bigint;
  /** Recipient on Base (EOA / smart wallet — same address by default). */
  recipient: string;
  /** Defaults to Ethereum; destination defaults to the opposite chain. */
  sourceChainId?: BridgeChainId;
  destChainId?: BridgeChainId;
}): Promise<BridgeQuote> {
  const { token, amountWei, recipient } = params;
  assertBridgeAmount(amountWei);
  if (!isAddress(recipient)) throw new Error("Recipient must be a valid address.");
  const route = resolveBridgeRoute(params.sourceChainId, params.destChainId);
  const sdk = params.sdk ?? createBridgeSdk(route.sourceChainId);
  const quote = await sdk.getBridgeQuote({
    ...route,
    token,
    amount: amountWei,
    recipient,
    sourceRpcUrl: bridgeRpcUrl(route.sourceChainId),
  });
  return {
    nativeFeeWei: quote.nativeFee,
    lzTokenFeeWei: quote.lzTokenFee,
    ...route,
    oftAdapter: oftAdapterForChain(token, route.sourceChainId),
  };
}

/**
 * Executor-ready route. Ethereum may return [approve, OFT.send]; Base returns
 * a single child-OFT send because the source token is the OFT itself.
 */
export async function quoteBridge(params: {
  sdk?: FxSdk;
  userAddress: `0x${string}`;
  token: BridgeToken;
  /** Amount in wei (18 decimals). */
  amountWei: bigint;
  /** Recipient on the destination chain. Defaults to userAddress. */
  recipient?: `0x${string}`;
  /** Defaults to Ethereum; destination defaults to the opposite chain. */
  sourceChainId?: BridgeChainId;
  destChainId?: BridgeChainId;
  /** Allowance reader override (tests). */
  readAllowance?: (
    token: `0x${string}`,
    owner: `0x${string}`,
    spender: `0x${string}`
  ) => Promise<bigint>;
}): Promise<{ txs: TradeTx[]; quote: BridgeQuote }> {
  const { userAddress, token, amountWei } = params;
  const recipient = params.recipient ?? userAddress;
  assertBridgeAmount(amountWei);
  if (!isAddress(userAddress) || !isAddress(recipient)) {
    throw new Error("Bridge wallet and recipient must be valid addresses.");
  }
  const route = resolveBridgeRoute(params.sourceChainId, params.destChainId);
  const sdk = params.sdk ?? createBridgeSdk(route.sourceChainId);

  const tokenAddr = bridgeTokenAddress(token, route.sourceChainId);
  const adapter = oftAdapterForChain(token, route.sourceChainId);

  const built = await sdk.buildBridgeTx({
    ...route,
    token,
    amount: amountWei,
    recipient,
    refundAddress: userAddress,
    sourceRpcUrl: bridgeRpcUrl(route.sourceChainId),
  });
  if (built.tx.value !== built.quote.nativeFee) {
    throw new Error("bridge: SDK tx value does not match its LayerZero native-fee quote");
  }

  // OFT lockbox adapter pulls the token via transferFrom → ensure allowance.
  const raw: SdkTx[] = [];
  if (route.sourceChainId === CHAIN_ID_ETHEREUM) {
    const readAllowance =
      params.readAllowance ??
      ((t, owner, spender) =>
        createBridgePublicClient(CHAIN_ID_ETHEREUM).readContract({
          address: t,
          abi: erc20Abi,
          functionName: "allowance",
          args: [owner, spender],
        }));
    const allowance = await readAllowance(tokenAddr, userAddress, adapter);
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
  }
  raw.push({ to: built.tx.to, data: built.tx.data, value: built.tx.value });

  return {
    txs: assertKnownBridgeTargets(raw, token, route.sourceChainId, "bridge"),
    quote: {
      nativeFeeWei: built.quote.nativeFee,
      lzTokenFeeWei: built.quote.lzTokenFee,
      ...route,
      oftAdapter: adapter,
    },
  };
}
