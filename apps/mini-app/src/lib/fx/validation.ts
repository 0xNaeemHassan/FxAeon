import { decodeFunctionData, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";
import { validateReviewedAction } from "./actionValidation";
import type { FxChainId, PlannedRoute, PlannedTransaction, TransactionPolicy } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const APPROVE_SELECTOR = "0x095ea7b3";
const OFT_SEND_SELECTOR = "0xc7c7f5b3";
const MAX_UINT256 = (1n << 256n) - 1n;
const BRIDGE_EID_BY_CHAIN: Record<FxChainId, number> = {
  1: 30101,
  8453: 30184,
};
const OFT_SEND_ABI = parseAbi([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress)",
]);
/** FxAeon deliberately caps user-selected slippage below the SDK's broad 100% API. */
export const MAX_FX_SLIPPAGE_PERCENT = 2;

export function assertAddress(value: string, label = "address"): Address {
  if (!isAddress(value)) throw new Error(`${label} is not a valid EVM address`);
  return getAddress(value);
}

/**
 * fx-sdk@1.0.5 compares several token inputs against lowercase address
 * constants before it normalizes them. Validate first, then preserve that
 * upstream wire-format quirk only at the SDK call boundary. Review/policy
 * code continues to use checksummed addresses.
 */
export function toSdkTokenAddress(value: string, label = "token address"): Address {
  return assertAddress(value, label).toLowerCase() as Address;
}

export function assertWalletAddress(value: string): Address {
  return assertAddress(value, "wallet address");
}

export function assertPositiveAmount(value: bigint, label = "amount"): void {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new RangeError(`${label} must be a positive integer amount`);
  }
}

export function assertSlippage(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_FX_SLIPPAGE_PERCENT) {
    throw new RangeError(`slippage must be greater than 0 and at most ${MAX_FX_SLIPPAGE_PERCENT} percent`);
  }
}

export function assertPositionId(value: number, allowNew = false): void {
  const minimum = allowNew ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`position ID must be an integer >= ${minimum}`);
  }
}

export function assertLeverage(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("leverage must be greater than 0");
  }
}

export function assertDifferentChains(sourceChainId: FxChainId, destChainId: FxChainId): void {
  if (sourceChainId === destChainId) {
    throw new Error("bridge source and destination chains must differ");
  }
}

function selector(data: Hex): string {
  return data.slice(0, 10).toLowerCase();
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function validateApprovalShape(
  transaction: PlannedTransaction,
  policy: TransactionPolicy,
): void {
  if (transaction.kind === "approval" && selector(transaction.data) !== APPROVE_SELECTOR) {
    throw new Error("approval transactions must use canonical approve calldata");
  }
  if (selector(transaction.data) !== APPROVE_SELECTOR) return;
  if (transaction.kind !== "approval") throw new Error("approve calldata must be classified as an approval");
  if (transaction.value !== 0n) throw new Error("approval transactions cannot carry native value");
  const body = transaction.data.slice(2);
  if (body.length !== 8 + 64 + 64) throw new Error("approval calldata is not canonical ABI encoding");
  const spender = paddedWordToAddress(body.slice(8, 8 + 64));
  const amount = BigInt(`0x${body.slice(8 + 64)}`);
  if (amount <= 0n || amount === MAX_UINT256) {
    throw new Error("approvals must be exact, positive, and never unlimited");
  }
  if (policy.allowedApprovalDestinations
    && !policy.allowedApprovalDestinations.some((destination) => sameAddress(destination, transaction.to))) {
    throw new Error(`approval destination ${transaction.to} is not allowed for this action`);
  }
  if (policy.allowedApprovalSpenders && !policy.allowedApprovalSpenders.some((item) => sameAddress(item, spender))) {
    throw new Error(`approval spender ${spender} is not permitted for this capability`);
  }
  if (transaction.type === "approveToken") {
    if (policy.allowedTokenApprovalDestinations
      && !policy.allowedTokenApprovalDestinations.some((destination) => sameAddress(destination, transaction.to))) {
      throw new Error("token approval destination does not match the reviewed token contract");
    }
    if (policy.expectedTokenApprovalAmount === undefined
      && policy.expectedPositionApprovalId !== undefined
      && !policy.allowActionBoundTokenApproval) {
      throw new Error("token approval is not part of the reviewed operation");
    }
    if (policy.expectedTokenApprovalAmount !== undefined
      && amount !== policy.expectedTokenApprovalAmount) {
      throw new Error("token approval amount does not match the reviewed user amount");
    }
  }
  if (transaction.type === "approvePosition") {
    if (policy.allowedPositionApprovalDestinations
      && !policy.allowedPositionApprovalDestinations.some((destination) => sameAddress(destination, transaction.to))) {
      throw new Error("position approval destination does not match the reviewed pool contract");
    }
    if (policy.expectedPositionApprovalId === undefined
      && policy.expectedTokenApprovalAmount !== undefined) {
      throw new Error("position approval is not part of the reviewed operation");
    }
    if (policy.expectedPositionApprovalId !== undefined
      && amount !== BigInt(policy.expectedPositionApprovalId)) {
      throw new Error("position approval ID does not match the reviewed position");
    }
  }
  if ((policy.expectedTokenApprovalAmount !== undefined
      || policy.expectedPositionApprovalId !== undefined
      || policy.allowActionBoundTokenApproval)
    && transaction.operation !== "buildBridgeTx"
    && transaction.type !== "approveToken"
    && transaction.type !== "approvePosition") {
    throw new Error("SDK approval type is not bound to a reviewed token amount or position ID");
  }
}

/** Validate the security-relevant shape of a single SDK transaction. */
export function validateTransaction(
  transaction: PlannedTransaction,
  policy: TransactionPolicy,
): void {
  const expectedWallet = assertWalletAddress(policy.walletAddress);
  if (transaction.chainId !== policy.chainId) {
    throw new Error(
      `transaction chain ${transaction.chainId} does not match policy chain ${policy.chainId}`,
    );
  }
  if (!sameAddress(transaction.from, expectedWallet)) {
    throw new Error("transaction sender does not match the connected wallet");
  }
  if (sameAddress(transaction.to, ZERO_ADDRESS)) {
    throw new Error("transaction destination cannot be the zero address");
  }
  if (transaction.value < 0n) throw new Error("transaction value cannot be negative");
  if (policy.maxValueWei !== undefined && transaction.value > policy.maxValueWei) {
    throw new Error("transaction native value exceeds the reviewed limit");
  }
  if (transaction.nonce !== undefined && (!Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0)) {
    throw new Error("transaction nonce is invalid");
  }

  if (policy.allowedDestinations && !policy.allowedDestinations.some((destination) =>
    sameAddress(destination, transaction.to)
  )) {
    throw new Error(`transaction destination ${transaction.to} is not allowed for this action`);
  }
  if (policy.allowedDestinations && !policy.allowedSelectors) {
    throw new Error("transaction selector manifest is required for an allow-listed capability");
  }
  const isApproval = transaction.kind === "approval" || selector(transaction.data) === APPROVE_SELECTOR;
  const actionDestinations = policy.allowedActionDestinations;
  const actionSelectors = policy.allowedActionSelectors;
  if (!isApproval && actionDestinations
    && !actionDestinations.some((destination) => sameAddress(destination, transaction.to))) {
    throw new Error(`transaction action destination ${transaction.to} is not allowed for this operation`);
  }
  if (!isApproval && actionDestinations && !actionSelectors) {
    throw new Error("action selector manifest is required for an operation allow-list");
  }
  const allowedSelectors = (!isApproval && actionSelectors
    ? actionSelectors[transaction.to.toLowerCase()]
    : policy.allowedSelectors?.[transaction.to.toLowerCase()]);
  if ((!isApproval && actionDestinations && actionSelectors && !allowedSelectors)
    || (!actionDestinations && policy.allowedDestinations && policy.allowedSelectors && !allowedSelectors)) {
    throw new Error(`no selector manifest exists for allowed destination ${transaction.to}`);
  }
  if (allowedSelectors && !allowedSelectors.some((allowed) => allowed.toLowerCase() === selector(transaction.data))) {
    throw new Error(`transaction selector ${selector(transaction.data)} is not allowed for ${transaction.to}`);
  }
  validateApprovalShape(transaction, policy);
}

/**
 * Validate the entire ordered route before showing a signing prompt. SDK
 * nonces are advisory until reconciled with the chain, but when present they
 * must form a contiguous sequence.
 */
export function validateRoute(route: PlannedRoute, policy: TransactionPolicy): void {
  if (route.transactions.length === 0) throw new Error("cannot execute an empty route");
  if (route.chainId !== 1 && route.chainId !== 8453) throw new Error("route chain is not supported");
  assertWalletAddress(route.walletAddress);
  assertWalletAddress(policy.walletAddress);
  if (route.chainId !== policy.chainId) throw new Error("route chain does not match policy chain");
  if (!sameAddress(route.walletAddress, policy.walletAddress)) {
    throw new Error("route wallet does not match policy wallet");
  }
  route.transactions.forEach((transaction) => {
    if (transaction.operation !== route.operation) {
      throw new Error("transaction operation does not match the reviewed route");
    }
    validateTransaction(transaction, policy);
  });
  if (policy.reviewedAction) {
    const actions = route.transactions.filter((transaction) =>
      transaction.kind !== "approval" && selector(transaction.data) !== APPROVE_SELECTOR
    );
    if (actions.length !== 1) {
      throw new Error("reviewed route must contain exactly one protocol action");
    }
    const binding = validateReviewedAction(actions[0], policy.reviewedAction);
    if (policy.allowActionBoundTokenApproval) {
      const expectedAmount = binding.actionBoundTokenApprovalAmount;
      if (expectedAmount === undefined) {
        throw new Error("reviewed action did not provide its fee-adjusted approval amount");
      }
      const tokenApprovals = route.transactions.filter((transaction) =>
        transaction.kind === "approval" && transaction.type === "approveToken"
      );
      if (tokenApprovals.length > 1) {
        throw new Error("reviewed route cannot contain multiple token approvals");
      }
      if (tokenApprovals.length === 1) {
        const body = tokenApprovals[0].data.slice(2);
        const approvedAmount = BigInt(`0x${body.slice(8 + 64)}`);
        if (approvedAmount !== expectedAmount) {
          throw new Error("token approval amount does not match the decoded protocol action");
        }
      }
    }
  }
  let previousNonce: number | undefined;
  for (const transaction of route.transactions) {
    if (transaction.nonce === undefined) {
      previousNonce = undefined;
      continue;
    }
    if (previousNonce !== undefined && transaction.nonce !== previousNonce + 1) {
      throw new Error("SDK transaction nonces are not ordered contiguously");
    }
    previousNonce = transaction.nonce;
  }
  if (route.operation === "buildBridgeTx") {
    validateBridgeRoute(route);
  }
}

/** Bridge routes are one optional exact approval followed by one OFT send. */
export function validateBridgeRoute(route: PlannedRoute): void {
  const approvals = route.transactions.filter((transaction) => transaction.kind === "approval");
  const actions = route.transactions.filter((transaction) => transaction.kind !== "approval");
  if (actions.length !== 1) throw new Error("bridge route must contain exactly one OFT send action");
  if (approvals.length > 1 || (approvals.length === 1 && route.transactions[0] !== approvals[0])) {
    throw new Error("bridge approval must be the single first transaction");
  }
  const action = actions[0];
  if (selector(action.data) !== OFT_SEND_SELECTOR) {
    throw new Error("bridge route must use the official OFT send selector");
  }
  if (approvals.length === 1) {
    const approvalSpender = paddedWordToAddress(approvals[0].data.slice(2 + 8, 2 + 8 + 64));
    if (!sameAddress(approvalSpender, action.to)) {
      throw new Error("bridge approval spender must match the OFT send destination");
    }
  }
  const quote = route.quote as {
    nativeFee?: unknown;
    lzTokenFee?: unknown;
    sourceOftAddress?: unknown;
    destinationChainId?: unknown;
    destinationEid?: unknown;
    recipient?: unknown;
    recipientBytes32?: unknown;
    amountLD?: unknown;
    minAmountLD?: unknown;
    extraOptions?: unknown;
    composeMsg?: unknown;
    oftCmd?: unknown;
    refundAddress?: unknown;
    approvalTokenAddress?: unknown;
    bridgeAmount?: unknown;
    deliveryLowerBound?: unknown;
    destinationOftAddress?: unknown;
    destinationBaselineBlock?: unknown;
  } | undefined;
  if (!quote || typeof quote.nativeFee !== "bigint" || quote.nativeFee < 0n) {
    throw new Error("bridge route is missing the SDK LayerZero native fee quote");
  }
  if (typeof quote.lzTokenFee !== "bigint" || quote.lzTokenFee < 0n) {
    throw new Error("bridge route is missing the SDK LayerZero token fee quote");
  }
  if (typeof quote.sourceOftAddress !== "string" || !isAddress(quote.sourceOftAddress) || sameAddress(quote.sourceOftAddress, ZERO_ADDRESS)) {
    throw new Error("bridge route is missing the reviewed source OFT snapshot");
  }
  if (!sameAddress(action.to, quote.sourceOftAddress)) {
    throw new Error("bridge OFT send destination does not match the reviewed source OFT");
  }
  if (quote.destinationChainId !== 1 && quote.destinationChainId !== 8453) {
    throw new Error("bridge route is missing a supported destination chain snapshot");
  }
  if (quote.destinationChainId === route.chainId) {
    throw new Error("bridge destination chain must differ from its source chain");
  }
  if (typeof quote.destinationOftAddress !== "string" || !isAddress(quote.destinationOftAddress) || sameAddress(quote.destinationOftAddress, ZERO_ADDRESS)) {
    throw new Error("bridge route is missing the reviewed destination OFT snapshot");
  }
  if (typeof quote.destinationBaselineBlock !== "bigint" || quote.destinationBaselineBlock < 0n) {
    throw new Error("bridge route is missing the destination verification baseline block");
  }
  if (quote.destinationEid !== BRIDGE_EID_BY_CHAIN[quote.destinationChainId]) {
    throw new Error("bridge destination EID does not match the reviewed destination chain");
  }
  if (typeof quote.recipient !== "string" || !isAddress(quote.recipient) || sameAddress(quote.recipient, ZERO_ADDRESS)) {
    throw new Error("bridge route is missing the reviewed recipient snapshot");
  }
  if (typeof quote.recipientBytes32 !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(quote.recipientBytes32)) {
    throw new Error("bridge route recipient bytes32 snapshot is malformed");
  }
  if (quote.recipientBytes32.toLowerCase() !== addressToBytes32(quote.recipient).toLowerCase()) {
    throw new Error("bridge recipient bytes32 snapshot does not match the reviewed recipient");
  }
  if (typeof quote.amountLD !== "bigint" || quote.amountLD <= 0n) {
    throw new Error("bridge route is missing a positive reviewed amount");
  }
  if (typeof quote.minAmountLD !== "bigint" || quote.minAmountLD <= 0n || quote.minAmountLD > quote.amountLD) {
    throw new Error("bridge route is missing a valid reviewed minimum amount");
  }
  if (typeof quote.extraOptions !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(quote.extraOptions)) {
    throw new Error("bridge route is missing reviewed extra options bytes");
  }
  if (typeof quote.composeMsg !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(quote.composeMsg)) {
    throw new Error("bridge route is missing reviewed compose message bytes");
  }
  if (typeof quote.oftCmd !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(quote.oftCmd)) {
    throw new Error("bridge route is missing reviewed OFT command bytes");
  }
  const expectedMinimum = (quote.amountLD / (10n ** 14n)) * (10n ** 14n);
  if (quote.minAmountLD !== expectedMinimum) {
    throw new Error("bridge minimum amount does not match the SDK four-decimal bound");
  }
  if (quote.bridgeAmount !== undefined && (typeof quote.bridgeAmount !== "bigint" || quote.bridgeAmount !== quote.amountLD)) {
    throw new Error("bridge display amount does not match the reviewed bridge amount");
  }
  if (quote.deliveryLowerBound !== undefined && (typeof quote.deliveryLowerBound !== "bigint" || quote.deliveryLowerBound !== quote.minAmountLD)) {
    throw new Error("bridge delivery bound does not match the reviewed minimum amount");
  }
  if (typeof quote.refundAddress !== "string" || !isAddress(quote.refundAddress) || sameAddress(quote.refundAddress, ZERO_ADDRESS)) {
    throw new Error("bridge route is missing the reviewed refund address snapshot");
  }
  if (action.value !== quote.nativeFee) {
    throw new Error("bridge native value must equal the SDK LayerZero quote");
  }

  let decoded: {
    dstEid: number;
    to: Hex;
    amountLD: bigint;
    minAmountLD: bigint;
    extraOptions: Hex;
    composeMsg: Hex;
    oftCmd: Hex;
  };
  let decodedFee: { nativeFee: bigint; lzTokenFee: bigint };
  let decodedRefundAddress: Address;
  try {
    const result = decodeFunctionData({ abi: OFT_SEND_ABI, data: action.data });
    const args = result.args;
    if (!args || args.length !== 3) throw new Error("send arguments are incomplete");
    const [decodedArgs, decodedFeeArgs, decodedRefundArgs] = args as readonly [typeof decoded, typeof decodedFee, Address];
    decoded = decodedArgs;
    decodedFee = decodedFeeArgs;
    decodedRefundAddress = decodedRefundArgs;
  } catch (cause) {
    throw new Error(`bridge OFT send calldata could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (decoded.dstEid !== quote.destinationEid) {
    throw new Error("bridge calldata destination EID does not match the reviewed route");
  }
  if (decoded.to.toLowerCase() !== quote.recipientBytes32.toLowerCase()) {
    throw new Error("bridge calldata recipient does not match the reviewed route");
  }
  if (decoded.amountLD !== quote.amountLD) {
    throw new Error("bridge calldata amount does not match the reviewed route");
  }
  if (decoded.minAmountLD !== quote.minAmountLD) {
    throw new Error("bridge calldata minimum amount does not match the reviewed route");
  }
  if (decoded.extraOptions.toLowerCase() !== quote.extraOptions.toLowerCase()) {
    throw new Error("bridge calldata extra options do not match the reviewed route");
  }
  if (decoded.composeMsg.toLowerCase() !== quote.composeMsg.toLowerCase()) {
    throw new Error("bridge calldata compose message does not match the reviewed route");
  }
  if (decoded.oftCmd.toLowerCase() !== quote.oftCmd.toLowerCase()) {
    throw new Error("bridge calldata OFT command does not match the reviewed route");
  }
  if (decodedRefundAddress.toLowerCase() !== quote.refundAddress.toLowerCase()) {
    throw new Error("bridge calldata refund address does not match the reviewed route");
  }
  if (decodedFee.nativeFee !== quote.nativeFee || decodedFee.lzTokenFee !== quote.lzTokenFee) {
    throw new Error("bridge calldata LayerZero fee does not match the reviewed quote");
  }

  if (approvals.length === 1) {
    if (route.chainId !== 1) throw new Error("Base bridge routes cannot contain an ERC-20 approval");
    if (typeof quote.approvalTokenAddress !== "string" || !isAddress(quote.approvalTokenAddress) || sameAddress(quote.approvalTokenAddress, ZERO_ADDRESS)) {
      throw new Error("bridge approval is present without a reviewed approval token snapshot");
    }
    if (!sameAddress(approvals[0].to, quote.approvalTokenAddress)) {
      throw new Error("bridge approval token does not match the reviewed approval token");
    }
    const approvalData = approvals[0].data.slice(2);
    if (approvalData.length !== 8 + 64 + 64) throw new Error("bridge approval calldata is not canonical ABI encoding");
    const approvedAmount = BigInt(`0x${approvalData.slice(8 + 64)}`);
    if (approvedAmount !== quote.amountLD) {
      throw new Error("bridge approval amount must equal the reviewed bridge amount");
    }
  }
}

function addressToBytes32(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

export function assertNonceMatches(
  transaction: PlannedTransaction,
  pendingNonce: number,
): number {
  if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0) {
    throw new Error("RPC returned an invalid pending nonce");
  }
  if (transaction.nonce !== undefined && transaction.nonce !== pendingNonce) {
    throw new Error(
      `nonce drift detected: SDK planned ${transaction.nonce}, chain pending nonce is ${pendingNonce}`,
    );
  }
  return transaction.nonce ?? pendingNonce;
}

function paddedWordToAddress(word: string): Address {
  if (!/^[0-9a-f]{64}$/i.test(word)) throw new Error("malformed approval address word");
  return assertAddress(`0x${word.slice(-40)}`, "approval spender");
}

/** Decode and verify an exact ERC-20 approve(address,uint256) transaction. */
export function validateExactApproval(
  transaction: PlannedTransaction,
  params: {
    owner: Address;
    tokenAddress: Address;
    spender: Address;
    amount: bigint;
  },
): void {
  validateTransaction(transaction, {
    walletAddress: params.owner,
    chainId: 1,
    allowedDestinations: [params.tokenAddress],
    allowedSelectors: {
      [params.tokenAddress.toLowerCase()]: [APPROVE_SELECTOR],
    },
    allowedApprovalSpenders: [params.spender],
  });
  if (transaction.value !== 0n) throw new Error("ERC-20 approval must carry zero native value");
  if (transaction.kind !== "approval") throw new Error("bridge approval is not classified as approval");
  if (params.amount <= 0n) throw new Error("approval amount must be positive");
  const data = transaction.data.slice(2);
  if (data.length !== 8 + 64 + 64 || selector(transaction.data) !== APPROVE_SELECTOR) {
    throw new Error("approval calldata is not approve(address,uint256)");
  }
  const approvedSpender = paddedWordToAddress(data.slice(8, 8 + 64));
  const approvedAmount = BigInt(`0x${data.slice(8 + 64)}`);
  if (!sameAddress(approvedSpender, params.spender)) {
    throw new Error("approval spender does not match the reviewed bridge destination");
  }
  if (approvedAmount !== params.amount) {
    throw new Error("approval amount must be exact; unlimited approvals are not permitted");
  }
}

export function assertSelector(data: Hex, allowed: readonly string[]): void {
  const actual = selector(data);
  if (!allowed.some((item) => item.toLowerCase() === actual)) {
    throw new Error(`calldata selector ${actual} is not allowed`);
  }
}

export { APPROVE_SELECTOR, OFT_SEND_SELECTOR };
