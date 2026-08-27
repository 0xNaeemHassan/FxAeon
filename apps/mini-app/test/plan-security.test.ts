import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, maxUint256, parseAbi, type Address, type Hex } from "viem";
import {
  buildBridgeApprovalTransaction,
} from "../src/lib/fx/bridge";
import {
  ETHEREUM_CAPABILITY_SELECTORS,
  ETHEREUM_CAPABILITY_TARGETS,
  capabilityPolicy,
  defaultTransactionPolicy,
  positionPoolAddress,
} from "../src/lib/fx/policy";
import { FX_TOKENS } from "../src/lib/fx/tokens";
import { normalizeSdkTransaction } from "../src/lib/fx/normalize";
import {
  assertNonceMatches,
  validateBridgeRoute,
  validateExactApproval,
  validateRoute,
  validateTransaction,
  toSdkTokenAddress,
} from "../src/lib/fx/validation";
import type { PlannedRoute, PlannedTransaction } from "../src/lib/fx/types";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const DESTINATION = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN = "0x3333333333333333333333333333333333333333" as Address;
const SPENDER = "0x4444444444444444444444444444444444444444" as Address;
const OPERATION = "increasePosition" as const;
const BRIDGE_ABI = parseAbi([
  "function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),(uint256 nativeFee,uint256 lzTokenFee),address refundAddress)",
]);

function recipientBytes32(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

function bridgeData(params: {
  destinationEid?: number;
  recipient?: Address;
  amount?: bigint;
  minimum?: bigint;
  nativeFee?: bigint;
  lzTokenFee?: bigint;
  extraOptions?: Hex;
  composeMsg?: Hex;
  oftCmd?: Hex;
  refundAddress?: Address;
} = {}): Hex {
  const amount = params.amount ?? 10n;
  return encodeFunctionData({
    abi: BRIDGE_ABI,
    functionName: "send",
    args: [{
      dstEid: params.destinationEid ?? 30184,
      to: recipientBytes32(params.recipient ?? WALLET),
      amountLD: amount,
      minAmountLD: params.minimum ?? amount,
      extraOptions: params.extraOptions ?? "0x",
      composeMsg: params.composeMsg ?? "0x",
      oftCmd: params.oftCmd ?? "0x",
    }, {
      nativeFee: params.nativeFee ?? 3n,
      lzTokenFee: params.lzTokenFee ?? 0n,
    }, params.refundAddress ?? WALLET],
  }) as Hex;
}

function raw(overrides: Record<string, unknown> = {}) {
  return {
    from: WALLET,
    to: DESTINATION,
    data: "0x12345678",
    value: 0n,
    nonce: 4,
    chainId: 1,
    type: "action",
    ...overrides,
  };
}

function normalized(overrides: Record<string, unknown> = {}): PlannedTransaction {
  return normalizeSdkTransaction(raw(overrides), {
    operation: OPERATION,
    chainId: 1,
    walletAddress: WALLET,
  });
}

test("normalization rejects malformed sender, chain, calldata, value, and nonce", () => {
  assert.throws(() => normalized({ from: "0x9999999999999999999999999999999999999999" }), /sender/);
  assert.throws(() => normalized({ chainId: 8453 }), /chain/);
  assert.throws(() => normalized({ data: "0x123" }), /calldata/);
  assert.throws(() => normalized({ data: "not-hex" }), /calldata/);
  assert.throws(() => normalized({ value: "not-an-integer" }), /value/);
  assert.throws(() => normalized({ value: -1n }), /negative/);
  assert.throws(() => normalized({ nonce: -1 }), /nonce/);
  assert.throws(() => normalized({ nonce: 1.5 }), /nonce/);
});

test("token addresses are lowercase only at the upstream SDK boundary", () => {
  assert.equal(toSdkTokenAddress(FX_TOKENS.WETH.address), FX_TOKENS.WETH.address.toLowerCase());
  assert.equal(toSdkTokenAddress(FX_TOKENS.WBTC.address), FX_TOKENS.WBTC.address.toLowerCase());
  assert.throws(() => toSdkTokenAddress("not-an-address"), /valid EVM address/);
});

test("route policy rejects an unknown destination and selector", () => {
  const policy = capabilityPolicy({ walletAddress: WALLET, chainId: 1 });
  const allowedTarget = ETHEREUM_CAPABILITY_TARGETS[0];
  const allowedSelector = ETHEREUM_CAPABILITY_SELECTORS[allowedTarget.toLowerCase()][0];
  const route: PlannedRoute = {
    operation: OPERATION,
    chainId: 1,
    walletAddress: WALLET,
    transactions: [normalized({ to: allowedTarget, data: `${allowedSelector}00000000` })],
  };
  assert.doesNotThrow(() => validateRoute(route, policy));

  assert.throws(
    () => validateRoute({ ...route, transactions: [normalized({ to: DESTINATION })] }, policy),
    /destination.*not allowed/,
  );
  assert.throws(
    () => validateRoute({ ...route, transactions: [normalized({ to: allowedTarget, data: "0xdeadbeef" })] }, policy),
    /selector.*not allowed/,
  );
});

test("operation policy does not allow a different official capability's action", () => {
  const policy = capabilityPolicy({ walletAddress: WALLET, chainId: 1, operation: "increasePosition" });
  const router = policy.allowedActionDestinations?.[0];
  assert.ok(router);
  const increaseSelector = policy.allowedActionSelectors?.[router.toLowerCase()]?.[0];
  assert.ok(increaseSelector);
  const valid: PlannedRoute = {
    operation: "increasePosition",
    chainId: 1,
    walletAddress: WALLET,
    transactions: [normalized({ to: router, data: `${increaseSelector}00000000` })],
  };
  assert.doesNotThrow(() => validateRoute(valid, policy));

  const fxSaveDeposit: PlannedTransaction = normalized({
    to: FX_TOKENS.fxSAVE.address,
    data: "0x6e553f65" + "00".repeat(64),
  });
  assert.throws(
    () => validateRoute({ ...valid, transactions: [{ ...fxSaveDeposit, operation: "increasePosition" }] }, policy),
    /action destination|not allowed/,
  );
  assert.throws(
    () => validateRoute({ ...valid, transactions: [{ ...valid.transactions[0], value: 1n }] }, policy),
    /native value/,
  );
});

test("reviewed policy supports both long/short selectors and binds native value plus approvals", () => {
  const router = "0x33636D49FbefBE798e15e7F356E8DBef543CC708" as Address;
  const amount = 25n;
  const policy = capabilityPolicy({
    walletAddress: WALLET,
    chainId: 1,
    operation: "increasePosition",
    maxValueWei: amount,
    expectedTokenApprovalAmount: amount,
    expectedPositionApprovalId: 7,
    approvalDestinations: [FX_TOKENS.WETH.address, positionPoolAddress("ETH", "short")],
  });
  const shortAction = normalized({
    to: router,
    data: "0x99414c10" + "00".repeat(32),
    value: amount,
  });
  assert.doesNotThrow(() => validateTransaction(shortAction, policy));
  assert.throws(() => validateTransaction({ ...shortAction, value: amount + 1n }, policy), /native value/);

  const approvalData = (approved: bigint) => encodeFunctionData({
    abi: parseAbi(["function approve(address spender, uint256 amount)"]),
    functionName: "approve",
    args: [router, approved],
  });
  const approval = normalized({
    to: FX_TOKENS.WETH.address,
    data: approvalData(amount),
    type: "approveToken",
  });
  assert.doesNotThrow(() => validateTransaction(approval, policy));
  assert.throws(
    () => validateTransaction({ ...approval, data: approvalData(amount + 1n) }, policy),
    /reviewed user amount/,
  );
  assert.throws(
    () => validateTransaction({ ...approval, to: FX_TOKENS.USDC.address }, policy),
    /destination.*not allowed/,
  );
});

test("position-only routes reject an unexpected token approval", () => {
  const pool = positionPoolAddress("BTC", "long");
  const router = "0x33636D49FbefBE798e15e7F356E8DBef543CC708" as Address;
  const policy = capabilityPolicy({
    walletAddress: WALLET,
    chainId: 1,
    operation: "reducePosition",
    expectedPositionApprovalId: 42,
    approvalDestinations: [pool],
  });
  const approval = normalized({
    to: pool,
    data: encodeFunctionData({
      abi: parseAbi(["function approve(address spender, uint256 amount)"]),
      functionName: "approve",
      args: [router, 42n],
    }),
    type: "approveToken",
  });
  assert.throws(() => validateTransaction(approval, policy), /token approval is not part/);
});

test("default bridge policy caps native value to the reviewed LayerZero fee", () => {
  const oft = ETHEREUM_CAPABILITY_TARGETS.find((target) =>
    ETHEREUM_CAPABILITY_SELECTORS[target.toLowerCase()]?.some((selector) => selector === "0xc7c7f5b3"),
  );
  assert.ok(oft);
  const action: PlannedTransaction = {
    chainId: 1,
    from: WALLET,
    to: oft,
    data: "0xc7c7f5b3" as Hex,
    value: 3n,
    kind: "action",
    operation: "buildBridgeTx",
  };
  const route: PlannedRoute = {
    operation: "buildBridgeTx",
    chainId: 1,
    walletAddress: WALLET,
    transactions: [action],
    quote: { nativeFee: 3n },
  };
  const policy = defaultTransactionPolicy(route);
  // Bridge-specific validation will reject this abbreviated route later;
  // the generic operation policy must at least preserve its exact fee cap.
  assert.equal(policy.maxValueWei, 3n);
  assert.throws(
    () => validateTransaction({ ...action, value: 4n }, policy),
    /native value/,
  );
});

test("Ethereum bridge approval is exact and never uses an unlimited allowance", () => {
  const amount = 123456789n;
  const approval = buildBridgeApprovalTransaction({
    owner: WALLET,
    tokenAddress: TOKEN,
    spender: SPENDER,
    amount,
  });
  const decoded = (approval.data.slice(10 + 24, 10 + 64) as string).toLowerCase();
  assert.equal(decoded, SPENDER.slice(2).toLowerCase());
  assert.equal(BigInt(`0x${approval.data.slice(-64)}`), amount);
  assert.notEqual(BigInt(`0x${approval.data.slice(-64)}`), maxUint256);

  const unlimitedData = encodeFunctionData({
    abi: parseAbi(["function approve(address spender, uint256 amount)"]),
    functionName: "approve",
    args: [SPENDER, maxUint256],
  });
  const unlimited = { ...approval, data: unlimitedData as Hex };
  assert.throws(
    () => validateExactApproval(unlimited, { owner: WALLET, tokenAddress: TOKEN, spender: SPENDER, amount }),
    /exact|unlimited/,
  );
  assert.throws(
    () => buildBridgeApprovalTransaction({ owner: WALLET, tokenAddress: TOKEN, spender: SPENDER, amount: maxUint256 }),
    /unlimited|max/,
  );
});

test("nonce reconciliation fails closed when a planned nonce drifts", () => {
  assert.equal(assertNonceMatches(normalized({ nonce: 12 }), 12), 12);
  assert.throws(() => assertNonceMatches(normalized({ nonce: 12 }), 13), /nonce drift/);
  assert.equal(assertNonceMatches(normalized({ nonce: undefined }), 13), 13);
});

test("bridge validation binds the first approval to the quoted OFT send", () => {
  const oft = "0x5555555555555555555555555555555555555555" as Address;
  const amount = 100000000000000n;
  const approval = buildBridgeApprovalTransaction({
    owner: WALLET,
    tokenAddress: TOKEN,
    spender: oft,
    amount,
  });
  const action: PlannedTransaction = {
    chainId: 1,
    from: WALLET,
    to: oft,
    data: bridgeData({ amount }),
    value: 3n,
    kind: "action",
    operation: "buildBridgeTx",
  };
  const route: PlannedRoute = {
    operation: "buildBridgeTx",
    chainId: 1,
    walletAddress: WALLET,
    transactions: [approval, action],
    quote: {
      nativeFee: 3n,
      lzTokenFee: 0n,
      sourceOftAddress: oft,
      destinationChainId: 8453,
      destinationEid: 30184,
      recipient: WALLET,
      recipientBytes32: recipientBytes32(WALLET),
      amountLD: amount,
      minAmountLD: amount,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
      refundAddress: WALLET,
      approvalTokenAddress: TOKEN,
      bridgeAmount: amount,
      destinationOftAddress: oft,
      destinationBaselineBlock: 123n,
    },
  };
  assert.doesNotThrow(() => validateBridgeRoute(route));
  assert.throws(
    () => validateBridgeRoute({ ...route, transactions: [action, approval] }),
    /first transaction/,
  );
  assert.throws(
    () => validateBridgeRoute({ ...route, quote: undefined }),
    /fee quote/,
  );
  assert.throws(
    () => validateBridgeRoute({
      ...route,
      transactions: [
        buildBridgeApprovalTransaction({ owner: WALLET, tokenAddress: TOKEN, spender: SPENDER, amount: 10n }),
        action,
      ],
    }),
    /spender.*destination/,
  );
});

test("bridge validation binds every authority-bearing send field and exact approval", () => {
  const oft = "0x5555555555555555555555555555555555555555" as Address;
  const amount = 100000000000000n;
  const minimum = 100000000000000n;
  const approval = buildBridgeApprovalTransaction({ owner: WALLET, tokenAddress: TOKEN, spender: oft, amount });
  const action: PlannedTransaction = {
    chainId: 1,
    from: WALLET,
    to: oft,
    data: bridgeData({ amount, minimum }),
    value: 3n,
    kind: "action",
    operation: "buildBridgeTx",
  };
  const route: PlannedRoute = {
    operation: "buildBridgeTx",
    chainId: 1,
    walletAddress: WALLET,
    transactions: [approval, action],
    quote: {
      nativeFee: 3n,
      lzTokenFee: 0n,
      sourceOftAddress: oft,
      destinationChainId: 8453,
      destinationEid: 30184,
      recipient: WALLET,
      recipientBytes32: recipientBytes32(WALLET),
      amountLD: amount,
      minAmountLD: minimum,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x",
      refundAddress: WALLET,
      approvalTokenAddress: TOKEN,
      destinationOftAddress: oft,
      destinationBaselineBlock: 123n,
    },
  };
  assert.doesNotThrow(() => validateBridgeRoute(route));
  const hostile = (data: Hex, approvalTx = approval, value = 3n) => validateBridgeRoute({
    ...route,
    transactions: [approvalTx, { ...action, data, value }],
  });
  assert.throws(() => hostile(bridgeData({ amount, minimum, recipient: DESTINATION })), /recipient/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, destinationEid: 30101 })), /EID/);
  assert.throws(() => hostile(bridgeData({ amount: amount + 1n, minimum })), /amount/);
  assert.throws(() => hostile(bridgeData({ amount, minimum: minimum - 1n })), /minimum/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, extraOptions: "0x01" })), /extra options/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, composeMsg: "0x01" })), /compose message/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, oftCmd: "0x01" })), /OFT command/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, refundAddress: DESTINATION })), /refund/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, nativeFee: 4n }), approval, 4n), /native value|fee/);
  assert.throws(() => hostile(bridgeData({ amount, minimum, lzTokenFee: 1n })), /fee/);
  const wrongApproval = buildBridgeApprovalTransaction({ owner: WALLET, tokenAddress: TOKEN, spender: oft, amount: amount - 1n });
  assert.throws(() => hostile(bridgeData({ amount, minimum }), wrongApproval), /approval amount/);
  const wrongApprovalToken = buildBridgeApprovalTransaction({ owner: WALLET, tokenAddress: SPENDER, spender: oft, amount });
  assert.throws(() => hostile(bridgeData({ amount, minimum }), wrongApprovalToken), /approval token/);
});
