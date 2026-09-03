import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import type {
  PlannedTransaction,
  ReviewedActionIntent,
} from "./types";
import { FX_TOKENS } from "./tokens";

const CONVERTER = "0x12AF4529129303D7FbD2563E242C4a2890525912" as Address;
const CLOSE_SENTINEL = 1n << 255n;

// Keep every human-readable ABI as a literal tuple. viem intentionally rejects
// a broad `string[]` because it cannot prove interpolated input is a valid ABI
// at compile time; literal declarations keep both Next's production type pass
// and runtime decoding fail-closed.
const POSITION_ABI = parseAbi([
  "function openOrAddPositionFlashLoanV2((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 borrowAmount,bytes data) payable",
  "function closeOrRemovePositionFlashLoanV2((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 amountOut,uint256 borrowAmount,bytes data)",
  "function openOrAddShortPositionFlashLoan((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 debtTokenBorrowAmount,bytes data) payable",
  "function closeOrRemoveShortPositionFlashLoan((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 fxUSDWithdrawAmount,uint256 debtTokenBorrowAmount,bytes data)",
] as const);

const MINT_ABI = parseAbi([
  "function borrowFromLong((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,(address pool,uint256 positionId,uint256 borrowAmount) borrowParams)",
  "function repayToLong((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,(address pool,uint256 positionId,uint256 withdrawAmount) repayParams)",
  "function repayToLongAndZapOut((address,uint256,address,bytes,uint256,bytes),(address,uint256,uint256),(address,address,uint256,uint256[],uint256,bytes))",
] as const);

const FXSAVE_ABI = parseAbi([
  "function claim(address receiver)",
  "function deposit(uint256 amount,address receiver)",
  "function depositToFxSave((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,address tokenInAddress,uint256 minShares,address receiver)",
  "function redeem(uint256 amount,address receiver,address owner)",
  "function requestRedeem(uint256 amount)",
  "function instantRedeemFromFxSave((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) fxusdParams,(address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) usdcParams,uint256 amount,address receiver)",
] as const);

const CONVERTER_ABI = parseAbi([
  "function convert(address tokenIn,uint256 amount,uint256 encoding,uint256[] routes)",
]);

const FLASH_DATA_ABI = [
  { type: "uint256" },
  { type: "uint256" },
  { type: "address" },
  { type: "bytes" },
] as const;

type ConversionReview = {
  label: string;
  minOut?: bigint;
  fingerprint: Hex;
};

export type ReviewedActionBinding = {
  actionBoundTokenApprovalAmount?: bigint;
  economicLimits?: readonly { label: string; value: bigint }[];
  conversionPaths?: readonly { label: string; fingerprint: Hex }[];
  /** Hash of the complete protocol action calldata, including every encoded
   * amount, leverage, minOut, converter route, and receiver. */
  actionDataFingerprint?: Hex;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function tupleField(value: unknown, name: string, index: number, label: string): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object" && name in value) {
    return (value as Record<string, unknown>)[name];
  }
  throw new Error(`${label} is missing ${name}`);
}

function addressField(value: unknown, name: string, index: number, label: string): Address {
  const field = tupleField(value, name, index, label);
  if (typeof field !== "string" || !isAddress(field)) {
    throw new Error(`${label} contains an invalid ${name}`);
  }
  return field as Address;
}

function bigintField(value: unknown, name: string, index: number, label: string): bigint {
  const field = tupleField(value, name, index, label);
  if (typeof field !== "bigint") throw new Error(`${label} contains an invalid ${name}`);
  return field;
}

function hexField(value: unknown, name: string, index: number, label: string): Hex {
  const field = tupleField(value, name, index, label);
  if (typeof field !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(field)) {
    throw new Error(`${label} contains invalid ${name} bytes`);
  }
  return field as Hex;
}

function expectAddress(actual: Address, expected: Address, label: string): void {
  if (!sameAddress(actual, expected)) throw new Error(`${label} does not match the reviewed action`);
}

function expectBigint(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new Error(`${label} does not match the reviewed action`);
}

function argsArray(args: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(args)) throw new Error(`${label} arguments are malformed`);
  return args;
}

function decodeAction(
  transaction: PlannedTransaction,
  abi: typeof POSITION_ABI | typeof MINT_ABI | typeof FXSAVE_ABI,
): { functionName: string; args: readonly unknown[] } {
  try {
    const decoded = decodeFunctionData({ abi, data: transaction.data });
    return {
      functionName: decoded.functionName,
      args: argsArray(decoded.args, decoded.functionName),
    };
  } catch (cause) {
    throw new Error(`action calldata could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function conversionFingerprint(params: {
  direction: 0 | 1 | 2;
  token: Address;
  target: Address;
  amount: bigint;
  minOut: bigint;
  encoding: bigint;
  routes: readonly bigint[];
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256[]" },
    ],
    [params.direction, params.token, params.target, params.amount, params.minOut, params.encoding, [...params.routes]],
  ));
}

function validateConverterCall(
  data: Hex,
  expectedToken?: Address,
  expectedAmount?: bigint,
): { token: Address; amount: bigint; encoding: bigint; routes: readonly bigint[] } {
  let decoded: ReturnType<typeof decodeFunctionData<typeof CONVERTER_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: CONVERTER_ABI, data });
  } catch (cause) {
    throw new Error(`converter calldata could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (decoded.functionName !== "convert") throw new Error("reviewed route must use the native converter function");
  const args = argsArray(decoded.args, "converter");
  const tokenIn = args[0];
  const amount = args[1];
  const encoding = args[2];
  const routes = args[3];
  if (typeof tokenIn !== "string" || !isAddress(tokenIn) || typeof amount !== "bigint"
    || typeof encoding !== "bigint" || encoding < 0n || !Array.isArray(routes)
    || routes.some((route) => typeof route !== "bigint" || route < 0n)) {
    throw new Error("converter calldata arguments are malformed");
  }
  if (expectedToken) expectAddress(tokenIn as Address, expectedToken, "converter input token");
  if (expectedAmount !== undefined) expectBigint(amount, expectedAmount, "converter input amount");
  return { token: tokenIn as Address, amount, encoding, routes: routes as bigint[] };
}

function validateConvertIn(
  params: unknown,
  expectedToken: Address,
  expectedAmount: bigint,
  label: string,
  options: { allowZeroIdentity?: boolean } = {},
): ConversionReview {
  expectAddress(addressField(params, "tokenIn", 0, label), expectedToken, `${label} token`);
  const amount = bigintField(params, "amount", 1, label);
  expectBigint(amount, expectedAmount, `${label} amount`);
  expectAddress(addressField(params, "target", 2, label), CONVERTER, `${label} target`);
  const converter = validateConverterCall(hexField(params, "data", 3, label), expectedToken, expectedAmount);
  const minOut = bigintField(params, "minOut", 4, label);
  // The pinned SDK deliberately encodes USDC/fxUSD fxSAVE deposits as an
  // identity converter route (encoding 0, no hops). Its on-chain
  // `queryConvert` returns zero for that no-op route, while the vault's
  // positive `minShares` remains the economic deposit guard. Do not generalize
  // this exception to routed conversions or to position actions.
  const isIdentityRoute = converter.encoding === 0n && converter.routes.length === 0;
  const isFxSaveIdentityInput = sameAddress(expectedToken, FX_TOKENS.USDC.address)
    || sameAddress(expectedToken, FX_TOKENS.fxUSD.address);
  const allowsIdentityZero = options.allowZeroIdentity === true && isIdentityRoute && isFxSaveIdentityInput;
  if (minOut < 0n || (expectedAmount > 0n && minOut === 0n && !allowsIdentityZero)) {
    throw new Error(`${label} minimum output must protect a positive conversion`);
  }
  const signature = hexField(params, "signature", 5, label);
  if (signature !== "0x") throw new Error(`${label} cannot carry an external signature`);
  return {
    label,
    minOut,
    fingerprint: conversionFingerprint({
      direction: 0,
      token: expectedToken,
      target: CONVERTER,
      amount,
      minOut,
      encoding: converter.encoding,
      routes: converter.routes,
    }),
  };
}

function validateConvertOut(params: unknown, expectedToken: Address, label: string): ConversionReview {
  expectAddress(addressField(params, "tokenOut", 0, label), expectedToken, `${label} token`);
  expectAddress(addressField(params, "converter", 1, label), CONVERTER, `${label} converter`);
  const encoding = bigintField(params, "encodings", 2, label);
  const routesValue = tupleField(params, "routes", 3, label);
  const minOut = bigintField(params, "minOut", 4, label);
  if (encoding < 0n || !Array.isArray(routesValue)
    || routesValue.some((route) => typeof route !== "bigint" || route < 0n)
    || minOut < 0n) {
    throw new Error(`${label} contains malformed converter limits or routes`);
  }
  const signature = hexField(params, "signature", 5, label);
  if (signature !== "0x") throw new Error(`${label} cannot carry an external signature`);
  return {
    label,
    minOut,
    fingerprint: conversionFingerprint({
      direction: 1,
      token: expectedToken,
      target: CONVERTER,
      amount: 0n,
      minOut,
      encoding,
      routes: routesValue as bigint[],
    }),
  };
}

function validateFlashData(data: unknown, expectedSwapToken: Address): ConversionReview {
  if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) {
    throw new Error("position flash data is malformed");
  }
  let decoded: readonly [bigint, bigint, Address, Hex];
  try {
    decoded = decodeAbiParameters(FLASH_DATA_ABI, data as Hex) as typeof decoded;
  } catch (cause) {
    throw new Error(`position flash data could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  expectAddress(decoded[2], CONVERTER, "position flash converter target");
  const converter = validateConverterCall(decoded[3], expectedSwapToken);
  return {
    label: "position flash conversion path",
    fingerprint: conversionFingerprint({
      direction: 2,
      token: converter.token,
      target: CONVERTER,
      amount: converter.amount,
      minOut: 0n,
      encoding: converter.encoding,
      routes: converter.routes,
    }),
  };
}

function expectedPositionFunction(
  positionType: "long" | "short",
  direction: "open" | "close",
): string {
  if (positionType === "short") {
    return direction === "open"
      ? "openOrAddShortPositionFlashLoan"
      : "closeOrRemoveShortPositionFlashLoan";
  }
  return direction === "open"
    ? "openOrAddPositionFlashLoanV2"
    : "closeOrRemovePositionFlashLoanV2";
}

function validatePosition(
  transaction: PlannedTransaction,
  intent: Extract<ReviewedActionIntent, { kind: "position-increase" | "position-reduce" | "position-adjust" }>,
): ReviewedActionBinding {
  const decoded = decodeAction(transaction, POSITION_ABI);
  const isOpen = decoded.functionName === "openOrAddPositionFlashLoanV2"
    || decoded.functionName === "openOrAddShortPositionFlashLoan";
  const expectedDirection = intent.kind === "position-increase"
    ? "open"
    : intent.kind === "position-reduce"
      ? "close"
      : isOpen ? "open" : "close";
  if (decoded.functionName !== expectedPositionFunction(intent.positionType, expectedDirection)) {
    throw new Error("position action selector does not match the reviewed side and operation");
  }
  const [conversion, pool, positionId, amountOutOrBorrow] = decoded.args;
  const flashData = isOpen ? decoded.args[4] : decoded.args[5];
  if (typeof pool !== "string" || !isAddress(pool)) throw new Error("position action pool is malformed");
  if (typeof positionId !== "bigint" || typeof amountOutOrBorrow !== "bigint") {
    throw new Error("position action numeric arguments are malformed");
  }
  expectAddress(pool as Address, intent.poolAddress, "position pool");
  expectBigint(positionId, BigInt(intent.positionId), "position ID");

  if (isOpen) {
    const token = intent.kind === "position-increase" ? intent.inputTokenAddress : intent.collateralTokenAddress;
    const amount = intent.kind === "position-increase" ? intent.inputAmount : 0n;
    const input = validateConvertIn(conversion, token, amount, "position input conversion");
    const expectedValue = intent.kind === "position-increase" && intent.nativeInput ? intent.inputAmount : 0n;
    expectBigint(transaction.value, expectedValue, "position native value");
    const flash = validateFlashData(flashData, intent.debtTokenAddress);
    return bindingFromConversions([input, flash]);
  }

  const outputToken = intent.kind === "position-reduce"
    ? intent.outputTokenAddress
    : intent.collateralTokenAddress;
  const output = validateConvertOut(conversion, outputToken, "position output conversion");
  expectBigint(transaction.value, 0n, "position native value");
  if (intent.kind === "position-reduce") {
    if ((output.minOut ?? 0n) <= 0n) {
      throw new Error("position reduction must retain a positive minimum output");
    }
    if (intent.isClosePosition && amountOutOrBorrow !== CLOSE_SENTINEL) {
      throw new Error("full position close is missing the reviewed close sentinel");
    }
    if (!intent.isClosePosition && amountOutOrBorrow === CLOSE_SENTINEL) {
      throw new Error("partial position reduction cannot encode a full close");
    }
  } else if (amountOutOrBorrow === CLOSE_SENTINEL) {
    throw new Error("leverage adjustment cannot encode a full close");
  }
  const flash = validateFlashData(flashData, intent.collateralTokenAddress);
  return bindingFromConversions([output, flash]);
}

function validateDepositAndMint(
  transaction: PlannedTransaction,
  intent: Extract<ReviewedActionIntent, { kind: "deposit-and-mint" }>,
): ReviewedActionBinding {
  const decoded = decodeAction(transaction, MINT_ABI);
  if (decoded.functionName !== "borrowFromLong") throw new Error("deposit/mint action selector is invalid");
  const [conversion, borrow] = decoded.args;
  const converted = validateConvertIn(conversion, intent.depositTokenAddress, intent.depositAmount, "deposit conversion");
  expectAddress(addressField(borrow, "pool", 0, "borrow parameters"), intent.poolAddress, "borrow pool");
  expectBigint(bigintField(borrow, "positionId", 1, "borrow parameters"), BigInt(intent.positionId), "borrow position ID");
  expectBigint(bigintField(borrow, "borrowAmount", 2, "borrow parameters"), intent.mintAmount, "mint amount");
  expectBigint(transaction.value, intent.nativeInput ? intent.depositAmount : 0n, "deposit native value");
  return bindingFromConversions([converted]);
}

function validateRepayAndWithdraw(
  transaction: PlannedTransaction,
  intent: Extract<ReviewedActionIntent, { kind: "repay-and-withdraw" }>,
): ReviewedActionBinding {
  const decoded = decodeAction(transaction, MINT_ABI);
  const zapExpected = !sameAddress(intent.withdrawTokenAddress, intent.collateralTokenAddress);
  if (decoded.functionName !== (zapExpected ? "repayToLongAndZapOut" : "repayToLong")) {
    throw new Error("repay/withdraw action does not match the reviewed output token");
  }
  const [conversion, repay, convertOut] = decoded.args;
  const payAmount = bigintField(conversion, "amount", 1, "repay conversion");
  const repayConversion = validateConvertIn(conversion, intent.repayTokenAddress, payAmount, "repay conversion");
  const repayMinimum = repayConversion.minOut ?? 0n;
  if (intent.minimumRepayAmount === 0n) {
    if (payAmount !== 0n || repayMinimum !== 0n) throw new Error("withdraw-only action cannot spend fxUSD");
  } else if (payAmount <= 0n || repayMinimum <= 0n || payAmount < repayMinimum) {
    throw new Error("repay action contains an invalid fee-adjusted payment");
  }
  expectAddress(addressField(repay, "pool", 0, "repay parameters"), intent.poolAddress, "repay pool");
  expectBigint(bigintField(repay, "positionId", 1, "repay parameters"), BigInt(intent.positionId), "repay position ID");
  const encodedWithdraw = bigintField(repay, "withdrawAmount", 2, "repay parameters");
  if (!zapExpected) expectBigint(encodedWithdraw, intent.withdrawAmount, "withdraw amount");
  const withdrawConversion = zapExpected
    ? validateConvertOut(convertOut, intent.withdrawTokenAddress, "withdraw output conversion")
    : undefined;
  if (withdrawConversion && intent.withdrawAmount > 0n && (withdrawConversion.minOut ?? 0n) <= 0n) {
    throw new Error("withdraw output conversion must retain a positive minimum output");
  }
  expectBigint(transaction.value, 0n, "repay native value");
  return {
    actionBoundTokenApprovalAmount: payAmount,
    ...bindingFromConversions(withdrawConversion ? [repayConversion, withdrawConversion] : [repayConversion]),
  };
}

function validateFxSaveDeposit(
  transaction: PlannedTransaction,
  intent: Extract<ReviewedActionIntent, { kind: "fxsave-deposit" }>,
): ReviewedActionBinding {
  const decoded = decodeAction(transaction, FXSAVE_ABI);
  if (intent.directBasePool) {
    if (decoded.functionName !== "deposit") throw new Error("base-pool deposit must use direct fxSAVE deposit");
    const [amount, receiver] = decoded.args;
    if (typeof amount !== "bigint" || typeof receiver !== "string" || !isAddress(receiver)) {
      throw new Error("direct fxSAVE deposit arguments are malformed");
    }
    expectBigint(amount, intent.amount, "fxSAVE deposit amount");
    expectAddress(receiver as Address, intent.receiver, "fxSAVE deposit receiver");
    return {};
  }
  if (decoded.functionName !== "depositToFxSave") throw new Error("routed fxSAVE deposit selector is invalid");
  const [conversion, tokenIn, minShares, receiver] = decoded.args;
  const converted = validateConvertIn(
    conversion,
    intent.tokenInAddress,
    intent.amount,
    "fxSAVE deposit conversion",
    { allowZeroIdentity: true },
  );
  if (typeof tokenIn !== "string" || !isAddress(tokenIn) || typeof minShares !== "bigint"
    || typeof receiver !== "string" || !isAddress(receiver)) {
    throw new Error("routed fxSAVE deposit arguments are malformed");
  }
  expectAddress(tokenIn as Address, intent.tokenInAddress, "fxSAVE deposit token");
  expectAddress(receiver as Address, intent.receiver, "fxSAVE deposit receiver");
  if (minShares <= 0n) throw new Error("fxSAVE deposit minimum shares must be positive");
  const binding = bindingFromConversions([converted]);
  return {
    ...binding,
    economicLimits: [
      ...(binding.economicLimits ?? []),
      { label: "fxSAVE minimum shares", value: minShares },
    ],
  };
}

function validateFxSaveWithdraw(
  transaction: PlannedTransaction,
  intent: Extract<ReviewedActionIntent, { kind: "fxsave-withdraw" }>,
): ReviewedActionBinding {
  const decoded = decodeAction(transaction, FXSAVE_ABI);
  if (intent.directBasePool) {
    if (decoded.functionName !== "redeem") throw new Error("base-pool withdrawal must use direct fxSAVE redeem");
    const [amount, receiver, owner] = decoded.args;
    if (typeof amount !== "bigint" || typeof receiver !== "string" || !isAddress(receiver)
      || typeof owner !== "string" || !isAddress(owner)) {
      throw new Error("direct fxSAVE withdrawal arguments are malformed");
    }
    expectBigint(amount, intent.amount, "fxSAVE withdrawal amount");
    expectAddress(receiver as Address, intent.receiver, "fxSAVE withdrawal receiver");
    expectAddress(owner as Address, intent.receiver, "fxSAVE withdrawal owner");
    return {};
  }
  if (!intent.instant) {
    if (decoded.functionName !== "requestRedeem") throw new Error("queued fxSAVE withdrawal selector is invalid");
    const [amount] = decoded.args;
    if (typeof amount !== "bigint") throw new Error("queued fxSAVE withdrawal amount is malformed");
    expectBigint(amount, intent.amount, "fxSAVE queued withdrawal amount");
    return {};
  }
  if (decoded.functionName !== "instantRedeemFromFxSave") throw new Error("instant fxSAVE withdrawal selector is invalid");
  const [fxusd, usdc, amount, receiver] = decoded.args;
  const fxusdOutput = validateConvertOut(fxusd, intent.tokenOutAddress, "fxUSD instant output");
  const usdcOutput = validateConvertOut(usdc, intent.tokenOutAddress, "USDC instant output");
  if ((fxusdOutput.minOut ?? 0n) + (usdcOutput.minOut ?? 0n) <= 0n) {
    throw new Error("instant fxSAVE withdrawal must retain a positive aggregate minimum output");
  }
  if (typeof amount !== "bigint" || typeof receiver !== "string" || !isAddress(receiver)) {
    throw new Error("instant fxSAVE withdrawal arguments are malformed");
  }
  expectBigint(amount, intent.amount, "fxSAVE instant withdrawal amount");
  expectAddress(receiver as Address, intent.receiver, "fxSAVE instant withdrawal receiver");
  return bindingFromConversions([fxusdOutput, usdcOutput]);
}

function bindingFromConversions(conversions: readonly ConversionReview[]): ReviewedActionBinding {
  return {
    economicLimits: conversions.flatMap((conversion) => conversion.minOut === undefined
      ? []
      : [{ label: `${conversion.label} minimum output`, value: conversion.minOut }]),
    conversionPaths: conversions.map((conversion) => ({
      label: conversion.label,
      fingerprint: conversion.fingerprint,
    })),
  };
}

/**
 * Decode and bind one non-approval action to the independently captured user
 * intent. Returns a fee-adjusted token amount when an approval must be tied to
 * action calldata rather than directly to the raw form value.
 */
export function validateReviewedAction(
  transaction: PlannedTransaction,
  intent: ReviewedActionIntent,
): ReviewedActionBinding {
  let binding: ReviewedActionBinding;
  switch (intent.kind) {
    case "position-increase":
    case "position-reduce":
    case "position-adjust":
      binding = validatePosition(transaction, intent);
      break;
    case "deposit-and-mint":
      binding = validateDepositAndMint(transaction, intent);
      break;
    case "repay-and-withdraw":
      binding = validateRepayAndWithdraw(transaction, intent);
      break;
    case "fxsave-deposit":
      binding = validateFxSaveDeposit(transaction, intent);
      break;
    case "fxsave-withdraw":
      binding = validateFxSaveWithdraw(transaction, intent);
      break;
    case "fxsave-claim": {
      const decoded = decodeAction(transaction, FXSAVE_ABI);
      if (decoded.functionName !== "claim") throw new Error("fxSAVE claim selector is invalid");
      const [receiver] = decoded.args;
      if (typeof receiver !== "string" || !isAddress(receiver)) throw new Error("fxSAVE claim receiver is malformed");
      expectAddress(receiver as Address, intent.receiver, "fxSAVE claim receiver");
      binding = {};
      break;
    }
  }

  const actualLimits = (binding.economicLimits ?? []).map((limit) => limit.value);
  if (intent.expectedEconomicLimits) {
    if (intent.expectedEconomicLimits.length !== actualLimits.length
      || intent.expectedEconomicLimits.some((expected, index) => expected !== actualLimits[index])) {
      throw new Error("transaction economic limits changed after review");
    }
  }
  const actualPaths = (binding.conversionPaths ?? []).map((path) => path.fingerprint.toLowerCase());
  if (intent.expectedConversionFingerprints) {
    if (intent.expectedConversionFingerprints.length !== actualPaths.length
      || intent.expectedConversionFingerprints.some((expected, index) => expected.toLowerCase() !== actualPaths[index])) {
      throw new Error("transaction converter path changed after review");
    }
  }
  const actionDataFingerprint = keccak256(transaction.data);
  if (intent.expectedActionDataFingerprint
    && intent.expectedActionDataFingerprint.toLowerCase() !== actionDataFingerprint.toLowerCase()) {
    throw new Error("protocol action calldata changed after review");
  }
  return { ...binding, actionDataFingerprint };
}
