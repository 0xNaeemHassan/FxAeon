import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {
  capabilityPolicy,
  positionCollateralTokenAddress,
  positionDebtTokenAddress,
  positionPoolAddress,
} from "../src/lib/fx/policy";
import { validateReviewedAction } from "../src/lib/fx/actionValidation";
import { FX_TOKENS } from "../src/lib/fx/tokens";
import type {
  OfficialFxMethod,
  PlannedRoute,
  PlannedTransaction,
  ReviewedActionIntent,
} from "../src/lib/fx/types";
import { validateRoute } from "../src/lib/fx/validation";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const ROUTER = "0x33636D49FbefBE798e15e7F356E8DBef543CC708" as Address;
const MINT_ROUTER = "0xB753366082466c4B5984312f0c4Bb97554be067E" as Address;
const FXSAVE = FX_TOKENS.fxSAVE.address;
const CONVERTER = "0x12AF4529129303D7FbD2563E242C4a2890525912" as Address;

const CONVERT_IN = "(address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature)";
const CONVERT_OUT = "(address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature)";
const POSITION_ABI = parseAbi([
  `function openOrAddPositionFlashLoanV2(${CONVERT_IN} params,address pool,uint256 positionId,uint256 borrowAmount,bytes data) payable`,
  `function closeOrRemovePositionFlashLoanV2(${CONVERT_OUT} params,address pool,uint256 positionId,uint256 amountOut,uint256 borrowAmount,bytes data)`,
  `function openOrAddShortPositionFlashLoan(${CONVERT_IN} params,address pool,uint256 positionId,uint256 debtTokenBorrowAmount,bytes data) payable`,
  `function closeOrRemoveShortPositionFlashLoan(${CONVERT_OUT} params,address pool,uint256 positionId,uint256 fxUSDWithdrawAmount,uint256 debtTokenBorrowAmount,bytes data)`,
]);
const MINT_ABI = parseAbi([
  `function borrowFromLong(${CONVERT_IN} convertInParams,(address pool,uint256 positionId,uint256 borrowAmount) borrowParams)`,
  `function repayToLong(${CONVERT_IN} convertInParams,(address pool,uint256 positionId,uint256 withdrawAmount) repayParams)`,
  `function repayToLongAndZapOut(${CONVERT_IN} convertInParams,(address pool,uint256 positionId,uint256 withdrawAmount) repayParams,${CONVERT_OUT} convertOutParams)`,
] as readonly string[]);
const SAVE_ABI = parseAbi([
  "function claim(address receiver)",
  "function deposit(uint256 amount,address receiver)",
  `function depositToFxSave(${CONVERT_IN} convertInParams,address tokenInAddress,uint256 minShares,address receiver)`,
  "function redeem(uint256 amount,address receiver,address owner)",
  "function requestRedeem(uint256 amount)",
  `function instantRedeemFromFxSave(${CONVERT_OUT} fxusdParams,${CONVERT_OUT} usdcParams,uint256 amount,address receiver)`,
]);
const CONVERTER_ABI = parseAbi([
  "function convert(address tokenIn,uint256 amount,uint256 encoding,uint256[] routes)",
]);
const APPROVE_ABI = parseAbi(["function approve(address spender,uint256 amount)"]);

function converterData(token: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: CONVERTER_ABI,
    functionName: "convert",
    args: [token, amount, 0n, []],
  });
}

function convertIn(token: Address, amount: bigint) {
  return {
    tokenIn: token,
    amount,
    target: CONVERTER,
    data: converterData(token, amount),
    minOut: amount,
    signature: "0x" as Hex,
  };
}

function convertOut(token: Address) {
  return {
    tokenOut: token,
    converter: CONVERTER,
    encodings: 0n,
    routes: [] as bigint[],
    minOut: 1n,
    signature: "0x" as Hex,
  };
}

function flashData(token: Address, amount = 9n): Hex {
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes" },
    ],
    [1n, amount, CONVERTER, converterData(token, amount)],
  );
}

function transaction(
  operation: OfficialFxMethod,
  to: Address,
  data: Hex,
  overrides: Partial<PlannedTransaction> = {},
): PlannedTransaction {
  return {
    operation,
    chainId: 1,
    from: WALLET,
    to,
    data,
    value: 0n,
    kind: "action",
    type: "trade",
    ...overrides,
  };
}

function route(operation: OfficialFxMethod, transactions: PlannedTransaction[]): PlannedRoute {
  return { operation, chainId: 1, walletAddress: WALLET, transactions };
}

function policy(operation: OfficialFxMethod, reviewedAction: ReviewedActionIntent, extra: Record<string, unknown> = {}) {
  return capabilityPolicy({
    walletAddress: WALLET,
    chainId: 1,
    operation,
    reviewedAction,
    ...extra,
  });
}

test("position calldata is bound to reviewed token, amount, pool, ID, converter and native value", () => {
  const pool = positionPoolAddress("ETH", "long");
  const input = FX_TOKENS.WETH.address;
  const intent: ReviewedActionIntent = {
    kind: "position-increase",
    poolAddress: pool,
    positionId: 7,
    inputTokenAddress: input,
    inputAmount: 10n,
    nativeInput: false,
    collateralTokenAddress: positionCollateralTokenAddress("ETH", "long"),
    debtTokenAddress: positionDebtTokenAddress("ETH", "long"),
    positionType: "long",
  };
  const action = (positionId = 7n, token = input, amount = 10n) => transaction(
    "increasePosition",
    ROUTER,
    encodeFunctionData({
      abi: POSITION_ABI,
      functionName: "openOrAddPositionFlashLoanV2",
      args: [convertIn(token, amount), pool, positionId, 4n, flashData(FX_TOKENS.fxUSD.address)],
    }),
  );
  const reviewed = policy("increasePosition", intent, {
    maxValueWei: 0n,
    expectedTokenApprovalAmount: 10n,
    expectedPositionApprovalId: 7,
    approvalDestinations: [input, pool],
  });
  assert.doesNotThrow(() => validateRoute(route("increasePosition", [action()]), reviewed));
  assert.throws(() => validateRoute(route("increasePosition", [action(8n)]), reviewed), /position ID/);
  assert.throws(() => validateRoute(route("increasePosition", [action(7n, OTHER)]), reviewed), /input conversion token/);
  assert.throws(() => validateRoute(route("increasePosition", [action(7n, input, 11n)]), reviewed), /input conversion amount/);
});

test("reviewed conversion floors and paths cannot change between planning and signing", () => {
  const pool = positionPoolAddress("ETH", "long");
  const input = FX_TOKENS.WETH.address;
  const baseIntent: ReviewedActionIntent = {
    kind: "position-increase",
    poolAddress: pool,
    positionId: 7,
    inputTokenAddress: input,
    inputAmount: 10n,
    nativeInput: false,
    collateralTokenAddress: positionCollateralTokenAddress("ETH", "long"),
    debtTokenAddress: positionDebtTokenAddress("ETH", "long"),
    positionType: "long",
  };
  const action = (minOut: bigint) => transaction(
    "increasePosition",
    ROUTER,
    encodeFunctionData({
      abi: POSITION_ABI,
      functionName: "openOrAddPositionFlashLoanV2",
      args: [
        { ...convertIn(input, 10n), minOut },
        pool,
        7n,
        4n,
        flashData(FX_TOKENS.fxUSD.address),
      ],
    }),
  );
  const initial = validateReviewedAction(action(9n), baseIntent);
  const boundIntent: ReviewedActionIntent = {
    ...baseIntent,
    expectedEconomicLimits: initial.economicLimits?.map((limit) => limit.value),
    expectedConversionFingerprints: initial.conversionPaths?.map((path) => path.fingerprint),
    expectedActionDataFingerprint: initial.actionDataFingerprint,
  };

  assert.doesNotThrow(() => validateReviewedAction(action(9n), boundIntent));
  assert.throws(
    () => validateReviewedAction(action(1n), boundIntent),
    /economic limits changed after review/,
  );

  // The complete calldata commitment catches transformed protocol values
  // (for example borrow/leverage fields) even when the economic/path checks
  // above have no independently decoded expectation for that field.
  const alteredBorrow = transaction(
    "increasePosition",
    ROUTER,
    encodeFunctionData({
      abi: POSITION_ABI,
      functionName: "openOrAddPositionFlashLoanV2",
      args: [{ ...convertIn(input, 10n), minOut: 9n }, pool, 7n, 5n, flashData(FX_TOKENS.fxUSD.address)],
    }),
  );
  assert.throws(
    () => validateReviewedAction(alteredBorrow, boundIntent),
    /protocol action calldata changed after review/,
  );

  const reduceIntent: ReviewedActionIntent = {
    kind: "position-reduce",
    poolAddress: pool,
    positionId: 7,
    outputTokenAddress: FX_TOKENS.USDC.address,
    collateralTokenAddress: positionCollateralTokenAddress("ETH", "long"),
    debtTokenAddress: positionDebtTokenAddress("ETH", "long"),
    positionType: "long",
    isClosePosition: false,
  };
  const reduceAction = (routes: bigint[]) => transaction(
    "reducePosition",
    ROUTER,
    encodeFunctionData({
      abi: POSITION_ABI,
      functionName: "closeOrRemovePositionFlashLoanV2",
      args: [
        { ...convertOut(FX_TOKENS.USDC.address), routes },
        pool,
        7n,
        5n,
        4n,
        flashData(positionCollateralTokenAddress("ETH", "long")),
      ],
    }),
  );
  const reviewedReduce = validateReviewedAction(reduceAction([]), reduceIntent);
  const boundReduce: ReviewedActionIntent = {
    ...reduceIntent,
    expectedEconomicLimits: reviewedReduce.economicLimits?.map((limit) => limit.value),
    expectedConversionFingerprints: reviewedReduce.conversionPaths?.map((path) => path.fingerprint),
    expectedActionDataFingerprint: reviewedReduce.actionDataFingerprint,
  };
  assert.throws(
    () => validateReviewedAction(reduceAction([1n]), boundReduce),
    /converter path changed after review/,
  );
});

test("position close and leverage-adjust routes bind side, close intent, and native converter path", () => {
  const pool = positionPoolAddress("BTC", "long");
  const collateral = positionCollateralTokenAddress("BTC", "long");
  const reduceIntent: ReviewedActionIntent = {
    kind: "position-reduce",
    poolAddress: pool,
    positionId: 9,
    outputTokenAddress: FX_TOKENS.USDC.address,
    collateralTokenAddress: collateral,
    debtTokenAddress: positionDebtTokenAddress("BTC", "long"),
    positionType: "long",
    isClosePosition: true,
  };
  const closeAction = (amountOut: bigint, output = FX_TOKENS.USDC.address, minOut = 1n) => transaction(
    "reducePosition",
    ROUTER,
    encodeFunctionData({
      abi: POSITION_ABI,
      functionName: "closeOrRemovePositionFlashLoanV2",
      args: [{ ...convertOut(output), minOut }, pool, 9n, amountOut, 8n, flashData(collateral)],
    }),
  );
  const closePolicy = policy("reducePosition", reduceIntent, {
    expectedPositionApprovalId: 9,
    approvalDestinations: [pool],
    tokenApprovalDestinations: [],
    positionApprovalDestinations: [pool],
  });
  assert.doesNotThrow(() => validateRoute(route("reducePosition", [closeAction(1n << 255n)]), closePolicy));
  assert.throws(() => validateRoute(route("reducePosition", [closeAction(1n)]), closePolicy), /close sentinel/);
  assert.throws(() => validateRoute(route("reducePosition", [closeAction(1n << 255n, OTHER)]), closePolicy), /output conversion token/);
  assert.throws(() => validateRoute(route("reducePosition", [closeAction(1n << 255n, FX_TOKENS.USDC.address, 0n)]), closePolicy), /positive minimum output/);

  const shortPool = positionPoolAddress("ETH", "short");
  const shortCollateral = positionCollateralTokenAddress("ETH", "short");
  const adjustIntent: ReviewedActionIntent = {
    kind: "position-adjust",
    poolAddress: shortPool,
    positionId: 11,
    collateralTokenAddress: shortCollateral,
    debtTokenAddress: positionDebtTokenAddress("ETH", "short"),
    positionType: "short",
  };
  const adjustAction = (amount = 0n) => transaction(
    "adjustPositionLeverage",
    ROUTER,
    encodeFunctionData({
      abi: POSITION_ABI,
      functionName: "openOrAddShortPositionFlashLoan",
      args: [convertIn(shortCollateral, amount), shortPool, 11n, 4n, flashData(positionDebtTokenAddress("ETH", "short"))],
    }),
  );
  const adjustPolicy = policy("adjustPositionLeverage", adjustIntent, {
    expectedPositionApprovalId: 11,
    approvalDestinations: [shortPool],
    tokenApprovalDestinations: [],
    positionApprovalDestinations: [shortPool],
  });
  assert.doesNotThrow(() => validateRoute(route("adjustPositionLeverage", [adjustAction()]), adjustPolicy));
  assert.throws(() => validateRoute(route("adjustPositionLeverage", [adjustAction(1n)]), adjustPolicy), /input conversion amount/);
});

test("deposit/mint binds both user amounts and position identity", () => {
  const pool = positionPoolAddress("BTC", "long");
  const intent: ReviewedActionIntent = {
    kind: "deposit-and-mint",
    poolAddress: pool,
    positionId: 4,
    depositTokenAddress: FX_TOKENS.WBTC.address,
    depositAmount: 20n,
    nativeInput: false,
    mintAmount: 30n,
  };
  const action = (mintAmount = 30n, receiverPool = pool) => transaction(
    "depositAndMint",
    MINT_ROUTER,
    encodeFunctionData({
      abi: MINT_ABI,
      functionName: "borrowFromLong",
      args: [convertIn(FX_TOKENS.WBTC.address, 20n), { pool: receiverPool, positionId: 4n, borrowAmount: mintAmount }],
    }),
  );
  const reviewed = policy("depositAndMint", intent, {
    expectedTokenApprovalAmount: 20n,
    expectedPositionApprovalId: 4,
    approvalDestinations: [FX_TOKENS.WBTC.address, pool],
    tokenApprovalDestinations: [FX_TOKENS.WBTC.address],
    positionApprovalDestinations: [pool],
  });
  assert.doesNotThrow(() => validateRoute(route("depositAndMint", [action()]), reviewed));
  assert.throws(() => validateRoute(route("depositAndMint", [action(31n)]), reviewed), /mint amount/);
  assert.throws(() => validateRoute(route("depositAndMint", [action(30n, OTHER)]), reviewed), /borrow pool/);
  const wrongTokenDestination = transaction(
    "depositAndMint",
    pool,
    encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [MINT_ROUTER, 20n] }),
    { kind: "approval", type: "approveToken" },
  );
  assert.throws(
    () => validateRoute(route("depositAndMint", [wrongTokenDestination, action()]), reviewed),
    /token approval destination/,
  );
});

test("repay approval is bound to fee-adjusted action amount, not the raw form value", () => {
  const pool = positionPoolAddress("ETH", "long");
  const intent: ReviewedActionIntent = {
    kind: "repay-and-withdraw",
    poolAddress: pool,
    positionId: 3,
    minimumRepayAmount: 100n,
    repayTokenAddress: FX_TOKENS.fxUSD.address,
    withdrawTokenAddress: FX_TOKENS.wstETH.address,
    withdrawAmount: 5n,
    collateralTokenAddress: FX_TOKENS.wstETH.address,
  };
  const action = transaction(
    "repayAndWithdraw",
    MINT_ROUTER,
    encodeFunctionData({
      abi: MINT_ABI,
      functionName: "repayToLong",
      args: [{ ...convertIn(FX_TOKENS.fxUSD.address, 102n), minOut: 100n }, { pool, positionId: 3n, withdrawAmount: 5n }],
    }),
  );
  const approval = (amount: bigint) => transaction(
    "repayAndWithdraw",
    FX_TOKENS.fxUSD.address,
    encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [MINT_ROUTER, amount] }),
    { kind: "approval", type: "approveToken" },
  );
  const reviewed = policy("repayAndWithdraw", intent, {
    expectedPositionApprovalId: 3,
    allowActionBoundTokenApproval: true,
    approvalDestinations: [FX_TOKENS.fxUSD.address, pool],
  });
  assert.doesNotThrow(() => validateRoute(route("repayAndWithdraw", [approval(102n), action]), reviewed));
  assert.throws(
    () => validateRoute(route("repayAndWithdraw", [approval(100n), action]), reviewed),
    /decoded protocol action/,
  );
});

test("repay zap-out binds the reviewed output token while preserving SDK-derived collateral math", () => {
  const pool = positionPoolAddress("ETH", "long");
  const intent: ReviewedActionIntent = {
    kind: "repay-and-withdraw",
    poolAddress: pool,
    positionId: 6,
    minimumRepayAmount: 40n,
    repayTokenAddress: FX_TOKENS.fxUSD.address,
    withdrawTokenAddress: FX_TOKENS.USDC.address,
    withdrawAmount: 25n,
    collateralTokenAddress: FX_TOKENS.wstETH.address,
  };
  const action = (output: Address) => transaction(
    "repayAndWithdraw",
    MINT_ROUTER,
    encodeFunctionData({
      abi: MINT_ABI,
      functionName: "repayToLongAndZapOut",
      args: [
        { ...convertIn(FX_TOKENS.fxUSD.address, 41n), minOut: 40n },
        { pool, positionId: 6n, withdrawAmount: 123456n },
        convertOut(output),
      ],
    }),
  );
  const reviewed = policy("repayAndWithdraw", intent, {
    expectedPositionApprovalId: 6,
    allowActionBoundTokenApproval: true,
    approvalDestinations: [FX_TOKENS.fxUSD.address, pool],
    tokenApprovalDestinations: [FX_TOKENS.fxUSD.address],
    positionApprovalDestinations: [pool],
  });
  assert.doesNotThrow(() => validateRoute(route("repayAndWithdraw", [action(FX_TOKENS.USDC.address)]), reviewed));
  assert.throws(() => validateRoute(route("repayAndWithdraw", [action(OTHER)]), reviewed), /withdraw output conversion token/);
});

test("fxSAVE deposit, withdrawal, and claim bind amounts and receivers", () => {
  const depositIntent: ReviewedActionIntent = {
    kind: "fxsave-deposit",
    tokenInAddress: FX_TOKENS.fxUSDBasePool.address,
    amount: 12n,
    receiver: WALLET,
    directBasePool: true,
  };
  const deposit = (receiver: Address) => transaction(
    "depositFxSave",
    FXSAVE,
    encodeFunctionData({ abi: SAVE_ABI, functionName: "deposit", args: [12n, receiver] }),
  );
  const depositPolicy = policy("depositFxSave", depositIntent, {
    expectedTokenApprovalAmount: 12n,
    approvalDestinations: [FX_TOKENS.fxUSDBasePool.address],
  });
  assert.doesNotThrow(() => validateRoute(route("depositFxSave", [deposit(WALLET)]), depositPolicy));
  assert.throws(() => validateRoute(route("depositFxSave", [deposit(OTHER)]), depositPolicy), /receiver/);

  const withdrawIntent: ReviewedActionIntent = {
    kind: "fxsave-withdraw",
    tokenOutAddress: FX_TOKENS.fxUSDBasePool.address,
    amount: 7n,
    receiver: WALLET,
    instant: false,
    directBasePool: true,
  };
  const withdraw = (owner: Address) => transaction(
    "withdrawFxSave",
    FXSAVE,
    encodeFunctionData({ abi: SAVE_ABI, functionName: "redeem", args: [7n, WALLET, owner] }),
  );
  const withdrawPolicy = policy("withdrawFxSave", withdrawIntent, {
    expectedTokenApprovalAmount: 7n,
    approvalDestinations: [FXSAVE],
  });
  assert.doesNotThrow(() => validateRoute(route("withdrawFxSave", [withdraw(WALLET)]), withdrawPolicy));
  assert.throws(() => validateRoute(route("withdrawFxSave", [withdraw(OTHER)]), withdrawPolicy), /owner/);

  const queuedIntent: ReviewedActionIntent = {
    kind: "fxsave-withdraw",
    tokenOutAddress: FX_TOKENS.fxUSD.address,
    amount: 8n,
    receiver: WALLET,
    instant: false,
    directBasePool: false,
  };
  const queued = (amount: bigint) => transaction(
    "withdrawFxSave",
    FXSAVE,
    encodeFunctionData({ abi: SAVE_ABI, functionName: "requestRedeem", args: [amount] }),
  );
  const queuedPolicy = policy("withdrawFxSave", queuedIntent, {
    expectedTokenApprovalAmount: 8n,
    approvalDestinations: [FXSAVE],
    tokenApprovalDestinations: [FXSAVE],
    positionApprovalDestinations: [],
  });
  assert.doesNotThrow(() => validateRoute(route("withdrawFxSave", [queued(8n)]), queuedPolicy));
  assert.throws(() => validateRoute(route("withdrawFxSave", [queued(9n)]), queuedPolicy), /queued withdrawal amount/);

  const claimIntent: ReviewedActionIntent = { kind: "fxsave-claim", receiver: WALLET };
  const claim = (receiver: Address) => transaction(
    "getRedeemTx",
    FXSAVE,
    encodeFunctionData({ abi: SAVE_ABI, functionName: "claim", args: [receiver] }),
  );
  const claimPolicy = policy("getRedeemTx", claimIntent);
  assert.doesNotThrow(() => validateRoute(route("getRedeemTx", [claim(WALLET)]), claimPolicy));
  assert.throws(() => validateRoute(route("getRedeemTx", [claim(OTHER)]), claimPolicy), /claim receiver/);
});

test("routed and instant fxSAVE calldata cannot redirect tokens or receivers", () => {
  const depositIntent: ReviewedActionIntent = {
    kind: "fxsave-deposit",
    tokenInAddress: FX_TOKENS.USDC.address,
    amount: 50n,
    receiver: WALLET,
    directBasePool: false,
  };
  const routedDeposit = (outerToken = FX_TOKENS.USDC.address) => transaction(
    "depositFxSave",
    ROUTER,
    encodeFunctionData({
      abi: SAVE_ABI,
      functionName: "depositToFxSave",
      args: [convertIn(FX_TOKENS.USDC.address, 50n), outerToken, 49n, WALLET],
    }),
  );
  const depositPolicy = policy("depositFxSave", depositIntent, {
    expectedTokenApprovalAmount: 50n,
    approvalDestinations: [FX_TOKENS.USDC.address],
  });
  assert.doesNotThrow(() => validateRoute(route("depositFxSave", [routedDeposit()]), depositPolicy));
  assert.throws(() => validateRoute(route("depositFxSave", [routedDeposit(OTHER)]), depositPolicy), /deposit token/);

  const withdrawIntent: ReviewedActionIntent = {
    kind: "fxsave-withdraw",
    tokenOutAddress: FX_TOKENS.USDC.address,
    amount: 33n,
    receiver: WALLET,
    instant: true,
    directBasePool: false,
  };
  const instant = (receiver: Address, secondToken = FX_TOKENS.USDC.address) => transaction(
    "withdrawFxSave",
    ROUTER,
    encodeFunctionData({
      abi: SAVE_ABI,
      functionName: "instantRedeemFromFxSave",
      args: [convertOut(FX_TOKENS.USDC.address), convertOut(secondToken), 33n, receiver],
    }),
  );
  const withdrawPolicy = policy("withdrawFxSave", withdrawIntent, {
    expectedTokenApprovalAmount: 33n,
    approvalDestinations: [FXSAVE],
  });
  assert.doesNotThrow(() => validateRoute(route("withdrawFxSave", [instant(WALLET)]), withdrawPolicy));
  assert.throws(() => validateRoute(route("withdrawFxSave", [instant(OTHER)]), withdrawPolicy), /receiver/);
  assert.throws(() => validateRoute(route("withdrawFxSave", [instant(WALLET, OTHER)]), withdrawPolicy), /USDC instant output token/);
});
