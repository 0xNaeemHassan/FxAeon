import {
  BRIDGE_OFT_BY_TOKEN,
  getEidByChainId,
  tokens as sdkTokens,
  type BridgeTokenId,
} from "@aladdindao/fx-sdk";
import {
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { getFxSdk } from "./sdk";
import { assertPublicClientChain, assertRpcUrlChain } from "./clients";
import { assertAlchemyRpcUrl } from "./config";
import { assertAddress, assertDifferentChains, assertPositiveAmount, validateExactApproval } from "./validation";
import { normalizeSdkTransaction } from "./normalize";
import type {
  BridgeApprovalParams,
  BridgePlanParams,
  BridgeRouteQuote,
  FxChainId,
  PlannedRoute,
  PlannedTransaction,
} from "./types";
import type { FxPublicClient } from "./types";
import { OFT_SEND_SELECTOR } from "./validation";

const FXSAVE_TOKEN_ADDRESS = "0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CANONICAL_BRIDGE_EXTRA_OPTIONS: Readonly<Record<BridgeTokenId, Hex>> = {
  fxUSD: "0x0003",
  fxSAVE: "0x000301001101000000000000000000000000000249f0",
};
const EMPTY_LAYERZERO_BYTES = "0x" as Hex;

const ERC20_APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
const ERC20_DECIMALS_ABI = [{
  type: "function",
  name: "decimals",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint8" }],
}] as const;
const OFT_METADATA_ABI = [
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "approvalRequired",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
const OFT_PEER_ABI = [{
  type: "function",
  name: "peers",
  stateMutability: "view",
  inputs: [{ name: "eid", type: "uint32" }],
  outputs: [{ name: "", type: "bytes32" }],
}] as const;

/** Keep the app's cross-version viem client boundary structural at read sites. */
async function readBridgeContract(client: { readContract: unknown }, request: unknown): Promise<unknown> {
  if (typeof client.readContract !== "function") throw new Error("bridge RPC client cannot perform contract reads");
  return (client.readContract as (args: unknown) => Promise<unknown>)(request);
}

/** The SDK rounds LayerZero's minAmountLD down to four decimals. */
export const BRIDGE_AMOUNT_UNIT = 10n ** 14n;

/** Advanced address fields must be explicit EIP-55 checksummed addresses. */
export function assertChecksummedAddress(value: string, label: string): Address {
  const normalized = assertAddress(value.trim(), label);
  if (value.trim() !== normalized) throw new Error(`${label} must use its EIP-55 checksum casing`);
  return normalized;
}

export function bridgeDeliveryLowerBound(amount: bigint): bigint {
  if (amount <= 0n) throw new RangeError("bridge amount must be positive");
  const lowerBound = (amount / BRIDGE_AMOUNT_UNIT) * BRIDGE_AMOUNT_UNIT;
  if (lowerBound <= 0n) {
    throw new RangeError("bridge amount is below the SDK's verifiable four-decimal delivery bound");
  }
  return lowerBound;
}

async function assertDeployedContract(params: {
  client: FxPublicClient;
  address: Address;
  label: string;
}): Promise<void> {
  const bytecode = await params.client.getBytecode({ address: params.address });
  if (!bytecode || bytecode === "0x") throw new Error(`${params.label} has no deployed bytecode`);
}

async function assertDeployed18DecimalToken(params: {
  client: FxPublicClient;
  address: Address;
  label: string;
}): Promise<void> {
  await assertDeployedContract(params);
  let decimals: unknown;
  try {
    decimals = await readBridgeContract(params.client, {
      address: params.address,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    });
  } catch (cause) {
    throw new Error(`${params.label} does not expose ERC-20 decimals(): ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (Number(decimals) !== 18) throw new Error(`${params.label} must expose exactly 18 decimals`);
}

function addressToBytes32(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
}

function assertPeer(value: unknown, expected: Address, label: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} returned malformed bytes32 peer metadata`);
  }
  if (/^0x0{64}$/i.test(value)) {
    throw new Error(`${label} has no configured LayerZero peer`);
  }
  if (value.toLowerCase() !== addressToBytes32(expected).toLowerCase()) {
    throw new Error(`${label} LayerZero peer does not match the reviewed remote OFT`);
  }
}

async function readOftMetadata(params: {
  client: FxPublicClient;
  address: Address;
  label: string;
}): Promise<{ localTokenAddress: Address; approvalRequired: boolean }> {
  await assertDeployedContract({ client: params.client, address: params.address, label: params.label });
  let localTokenAddress: unknown;
  let approvalRequired: unknown;
  try {
    [localTokenAddress, approvalRequired] = await Promise.all([
      readBridgeContract(params.client, { address: params.address, abi: OFT_METADATA_ABI, functionName: "token" }),
      readBridgeContract(params.client, { address: params.address, abi: OFT_METADATA_ABI, functionName: "approvalRequired" }),
    ]);
  } catch (cause) {
    throw new Error(`${params.label} does not expose the standardized IOFT token()/approvalRequired() metadata surface: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const localToken = assertAddress(String(localTokenAddress), `${params.label} local token`);
  if (typeof approvalRequired !== "boolean") throw new Error(`${params.label} returned invalid approvalRequired() metadata`);
  return { localTokenAddress: localToken, approvalRequired };
}

/**
 * Validate an explicitly supplied bridge OFT and its Ethereum-side approval
 * token before the official SDK is allowed to quote or build calldata.
 * `getBridgeQuote` remains the authoritative public-RPC probe for quoteSend;
 * the returned route is separately checked for the send selector.
 */
export async function validateAdvancedBridgeContracts(params: {
  sourceClient: FxPublicClient;
  destinationClient: FxPublicClient;
  sourceOftAddress: Address;
  destinationOftAddress: Address;
  ethereumApprovalTokenAddress?: Address;
  sourceChainId: FxChainId;
  destinationChainId: FxChainId;
}): Promise<{
  sourceTokenAddress: Address;
  destinationTokenAddress: Address;
  sourceApprovalRequired: boolean;
  destinationApprovalRequired: boolean;
}> {
  await Promise.all([
    assertPublicClientChain(params.sourceClient, params.sourceChainId),
    assertPublicClientChain(params.destinationClient, params.destinationChainId),
  ]);
  if (params.sourceClient.chain?.id !== undefined && params.sourceClient.chain.id !== params.sourceChainId) {
    throw new Error("advanced bridge source RPC client chain does not match the selected source chain");
  }
  if (params.destinationClient.chain?.id !== undefined && params.destinationClient.chain.id !== params.destinationChainId) {
    throw new Error("advanced bridge destination RPC client chain does not match the selected destination chain");
  }
  const sourceMetadata = await readOftMetadata({ client: params.sourceClient, address: params.sourceOftAddress, label: "source OFT" });
  const destinationMetadata = await readOftMetadata({ client: params.destinationClient, address: params.destinationOftAddress, label: "destination OFT" });
  await assertDeployed18DecimalToken({ client: params.sourceClient, address: sourceMetadata.localTokenAddress, label: "source local token" });
  await assertDeployed18DecimalToken({ client: params.destinationClient, address: destinationMetadata.localTokenAddress, label: "destination local token" });
  if (params.sourceChainId === 1) {
    if (sourceMetadata.approvalRequired) {
      if (!params.ethereumApprovalTokenAddress) throw new Error("Ethereum OFTAdapter requires an explicit underlying approval token");
      if (params.ethereumApprovalTokenAddress.toLowerCase() !== sourceMetadata.localTokenAddress.toLowerCase()) {
        throw new Error("Ethereum approval token must exactly match the source OFT token() metadata");
      }
    } else if (params.ethereumApprovalTokenAddress) {
      throw new Error("This Ethereum OFT does not require approval; remove the supplied approval token");
    }
  } else if (sourceMetadata.approvalRequired) {
    throw new Error("Base-source OFTAdapter approval is unsupported in advanced mode");
  } else if (params.ethereumApprovalTokenAddress) {
    throw new Error("An Ethereum underlying approval token is only valid for an Ethereum source bridge");
  }

  // A successful quote on each side only proves that each contract can price
  // a send. It does not prove that the two reviewed contracts are configured
  // as LayerZero peers. Require the symmetric OApp peer relationship before
  // allowing the official SDK route to be built.
  let sourcePeer: unknown;
  let destinationPeer: unknown;
  try {
    [sourcePeer, destinationPeer] = await Promise.all([
      readBridgeContract(params.sourceClient, {
        address: params.sourceOftAddress,
        abi: OFT_PEER_ABI,
        functionName: "peers",
        args: [getEidByChainId(params.destinationChainId)],
      }),
      readBridgeContract(params.destinationClient, {
        address: params.destinationOftAddress,
        abi: OFT_PEER_ABI,
        functionName: "peers",
        args: [getEidByChainId(params.sourceChainId)],
      }),
    ]);
  } catch (cause) {
    throw new Error(`advanced OFTs do not expose a readable LayerZero peers(uint32) surface: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  assertPeer(sourcePeer, params.destinationOftAddress, "source OFT");
  assertPeer(destinationPeer, params.sourceOftAddress, "destination OFT");

  return {
    sourceTokenAddress: sourceMetadata.localTokenAddress,
    destinationTokenAddress: destinationMetadata.localTokenAddress,
    sourceApprovalRequired: sourceMetadata.approvalRequired,
    destinationApprovalRequired: destinationMetadata.approvalRequired,
  };
}

/** Bind a built SDK route to the exact reviewed source OFT and OFT send ABI. */
export function assertBridgeActionTarget(route: PlannedRoute, expectedSourceOftAddress: Address): PlannedTransaction {
  const actions = route.transactions.filter((transaction) => transaction.kind !== "approval");
  if (actions.length !== 1) throw new Error("advanced bridge route must contain exactly one OFT send action");
  const action = actions[0];
  if (action.to.toLowerCase() !== expectedSourceOftAddress.toLowerCase()) {
    throw new Error("SDK bridge target does not match the reviewed source OFT");
  }
  if (action.data.slice(0, 10).toLowerCase() !== OFT_SEND_SELECTOR) {
    throw new Error("SDK bridge transaction does not use the OFT send selector");
  }
  return action;
}

export async function getBridgeApprovalAllowance(params: {
  client: Pick<PublicClient, "readContract">;
  tokenAddress: Address;
  owner: Address;
  spender: Address;
}): Promise<bigint> {
  const allowance = await readBridgeContract(params.client, {
    address: params.tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [params.owner, params.spender],
  });
  return allowance as bigint;
}

function canonicalTokenKey(token: string): BridgeTokenId | undefined {
  const lower = token.toLowerCase();
  if (lower === "fxusd") return "fxUSD";
  if (lower === "fxsave") return "fxSAVE";
  return undefined;
}

/** Independent expectation for every opaque authority-bearing send field. */
export function expectedBridgeSendBytes(token: string): {
  extraOptions: Hex;
  composeMsg: Hex;
  oftCmd: Hex;
} {
  const key = canonicalTokenKey(token);
  return {
    extraOptions: key ? CANONICAL_BRIDGE_EXTRA_OPTIONS[key] : EMPTY_LAYERZERO_BYTES,
    composeMsg: EMPTY_LAYERZERO_BYTES,
    oftCmd: EMPTY_LAYERZERO_BYTES,
  };
}

/** Resolve only official canonical tokens or an explicitly supplied OFT. */
export function resolveBridgeTokenAddress(token: string, chainId: FxChainId): Address {
  const key = canonicalTokenKey(token);
  if (key) {
    const address = BRIDGE_OFT_BY_TOKEN[key][chainId];
    return assertAddress(address, `${key} bridge OFT`);
  }
  return assertAddress(token, "bridge OFT");
}

/** Resolve the actual ERC-20 owner token for an Ethereum-side approval. */
export function resolveBridgeApprovalTokenAddress(token: string, chainId: FxChainId): Address {
  if (chainId !== 1) return resolveBridgeTokenAddress(token, chainId);
  const key = canonicalTokenKey(token);
  if (key === "fxUSD") return assertAddress(sdkTokens.fxUSD, "fxUSD token");
  if (key === "fxSAVE") return assertAddress(FXSAVE_TOKEN_ADDRESS, "fxSAVE token");
  return assertAddress(token, "bridge approval token");
}

/**
 * Build an exact ERC-20 approval for the Ethereum source bridge. The SDK's
 * buildBridgeTx deliberately returns only the OFT send transaction; this
 * helper supplies the one prerequisite approval and never uses max uint256.
 */
export function buildBridgeApprovalTransaction(params: BridgeApprovalParams): PlannedTransaction {
  const owner = assertAddress(params.owner, "approval owner");
  const tokenAddress = assertAddress(params.tokenAddress, "approval token");
  const spender = assertAddress(params.spender, "approval spender");
  assertPositiveAmount(params.amount, "bridge approval amount");
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, params.amount],
  });
  const tx: PlannedTransaction = {
    chainId: 1,
    from: owner,
    to: tokenAddress,
    data: data as Hex,
    value: 0n,
    kind: "approval",
    operation: params.operation ?? "buildBridgeTx",
  };
  validateExactApproval(tx, {
    owner,
    tokenAddress,
    spender,
    amount: params.amount,
  });
  return tx;
}

export interface BridgePlan extends PlannedRoute {
  operation: "buildBridgeTx";
  quote: BridgeRouteQuote;
}

/** Plan a bridge route using only the official SDK and its returned calldata. */
export async function planBridge(params: BridgePlanParams): Promise<BridgePlan> {
  assertDifferentChains(params.sourceChainId, params.destChainId);
  assertPositiveAmount(params.amount, "bridge amount");
  const minAmountLD = bridgeDeliveryLowerBound(params.amount);
  const walletAddress = assertAddress(params.walletAddress, "wallet address");
  const recipient = assertAddress(params.recipient, "bridge recipient");
  if (recipient.toLowerCase() === ZERO_ADDRESS) throw new Error("bridge recipient cannot be the zero address");
  const refundAddress = params.refundAddress
    ? assertAddress(params.refundAddress, "bridge refund address")
    : undefined;
  if (refundAddress?.toLowerCase() === ZERO_ADDRESS) throw new Error("bridge refund address cannot be the zero address");
  if (params.sourceChainId !== 1 && params.approvalTokenAddress) {
    throw new Error("Base bridge routes cannot carry an Ethereum approval token");
  }
  const tokenAddress = resolveBridgeTokenAddress(params.token, params.sourceChainId);
  const destinationOftAddress = assertAddress(params.destinationOftAddress, "destination bridge OFT");
  if (destinationOftAddress.toLowerCase() === ZERO_ADDRESS) throw new Error("destination bridge OFT cannot be the zero address");
  if (typeof params.destinationBaselineBlock !== "bigint" || params.destinationBaselineBlock < 0n) {
    throw new Error("destination baseline block must be a non-negative integer");
  }
  const approvalTokenAddress = params.approvalTokenAddress
    ? assertAddress(params.approvalTokenAddress, "bridge approval token")
    : bridgeTokenKey(params.token)
      ? resolveBridgeApprovalTokenAddress(params.token, params.sourceChainId)
      : undefined;
  if (!params.sourceRpcUrl) throw new Error("bridge source RPC URL is required");
  const sourceRpcUrl = assertAlchemyRpcUrl(params.sourceRpcUrl, params.sourceChainId, "bridge source RPC URL");
  await assertRpcUrlChain(sourceRpcUrl, params.sourceChainId);
  const expectedSendBytes = expectedBridgeSendBytes(params.token);
  const result = await getFxSdk().buildBridgeTx({
    sourceChainId: params.sourceChainId,
    destChainId: params.destChainId,
    token: params.token,
    amount: params.amount,
    recipient,
    refundAddress,
    sourceRpcUrl,
  });
  if (!result?.tx || typeof result.tx !== "object") {
    throw new Error("SDK returned a malformed bridge transaction");
  }
  const bridgeTx = normalizeSdkTransaction(result.tx, {
    operation: "buildBridgeTx",
    chainId: params.sourceChainId,
    walletAddress,
    kind: "action",
  });
  // The SDK resolves the requested token to a chain-specific OFT. Bind the
  // returned call to that exact address before it reaches the generic route
  // policy; this also makes the advanced OFT input fail closed if an SDK or
  // upstream response ever returns a different bridge contract.
  if (bridgeTx.to.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error("SDK bridge transaction target does not match the requested OFT");
  }
  const transactions: PlannedTransaction[] = [];
  const needsApproval = params.approvalAllowance === undefined || params.approvalAllowance < params.amount;
  if (params.sourceChainId === 1 && (params.includeApproval ?? true) && needsApproval) {
    if (!approvalTokenAddress) throw new Error("Ethereum bridge approval requires a reviewed ERC-20 token");
    transactions.push(buildBridgeApprovalTransaction({
      owner: walletAddress,
      tokenAddress: approvalTokenAddress,
      spender: bridgeTx.to,
      amount: params.amount,
    }));
  }
  transactions.push(bridgeTx);
  return {
    operation: "buildBridgeTx",
    chainId: params.sourceChainId,
    walletAddress,
    transactions,
    quote: {
      nativeFee: result.quote.nativeFee,
      lzTokenFee: result.quote.lzTokenFee,
      sourceOftAddress: tokenAddress,
      destinationOftAddress,
      destinationChainId: params.destChainId,
      destinationEid: getEidByChainId(params.destChainId),
      recipient,
      recipientBytes32: addressToBytes32(recipient),
      amountLD: params.amount,
      minAmountLD,
      ...expectedSendBytes,
      refundAddress: refundAddress ?? recipient,
      approvalTokenAddress: params.sourceChainId === 1 ? approvalTokenAddress : undefined,
      bridgeAmount: params.amount,
      deliveryLowerBound: minAmountLD,
      destinationBaselineBlock: params.destinationBaselineBlock,
    },
  };
}

export function bridgeTokenKey(token: string): BridgeTokenId | undefined {
  return canonicalTokenKey(token);
}
