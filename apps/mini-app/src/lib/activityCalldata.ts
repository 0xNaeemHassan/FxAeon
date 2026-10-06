import { decodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from 'viem';

/**
 * Display-only calldata facts for History. Decoding never authorizes
 * anything: callers combine these facts with the destination contract before
 * naming an action, and an undecodable call simply stays unclassified.
 */
export type DecodedActivityCall =
  | { kind: 'position'; side: 'long' | 'short'; direction: 'open' | 'close'; pool: Address; positionId: bigint; fullClose: boolean }
  | { kind: 'borrow'; pool: Address; positionId: bigint; borrowAmount: bigint }
  | { kind: 'repay'; pool: Address; positionId: bigint; repayAmount: bigint; withdrawAmount: bigint; zapOut: boolean }
  | { kind: 'fxsaveDeposit'; routed: boolean }
  | { kind: 'fxsaveRedeem'; instant: boolean; amount: bigint }
  | { kind: 'fxsaveRequestRedeem'; amount: bigint }
  | { kind: 'fxsaveClaim' }
  | { kind: 'approve'; spender: Address; amount: bigint }
  | { kind: 'transfer'; recipient: Address; amount: bigint }
  | { kind: 'oftSend'; destinationEid: number; amountLD: bigint }
  | { kind: 'wrap' }
  | { kind: 'unwrap'; amount: bigint };

/** The router encodes a full close as this amount-out sentinel (see fx/actionValidation.ts). */
export const POSITION_CLOSE_SENTINEL = 1n << 255n;

// Signatures mirror src/lib/fx/actionValidation.ts plus the canonical ERC-20,
// WETH, and LayerZero OFT entry points. Literal tuples keep viem's parser typed.
const ACTIVITY_ABI = parseAbi([
  'function openOrAddPositionFlashLoanV2((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 borrowAmount,bytes data)',
  'function closeOrRemovePositionFlashLoanV2((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 amountOut,uint256 borrowAmount,bytes data)',
  'function openOrAddShortPositionFlashLoan((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 debtTokenBorrowAmount,bytes data)',
  'function closeOrRemoveShortPositionFlashLoan((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 fxUSDWithdrawAmount,uint256 debtTokenBorrowAmount,bytes data)',
  'function borrowFromLong((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,(address pool,uint256 positionId,uint256 borrowAmount) borrowParams)',
  'function repayToLong((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,(address pool,uint256 positionId,uint256 withdrawAmount) repayParams)',
  // Unnamed like actionValidation's copy: the named form exceeds viem's type-level parser.
  'function repayToLongAndZapOut((address,uint256,address,bytes,uint256,bytes),(address,uint256,uint256),(address,address,uint256,uint256[],uint256,bytes))',
  'function depositToFxSave((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,address tokenInAddress,uint256 minShares,address receiver)',
  'function instantRedeemFromFxSave((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) fxusdParams,(address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) usdcParams,uint256 amount,address receiver)',
  'function deposit(uint256 amount,address receiver)',
  'function redeem(uint256 amount,address receiver,address owner)',
  'function requestRedeem(uint256 amount)',
  'function claim(address receiver)',
  'function approve(address spender,uint256 amount)',
  'function transfer(address to,uint256 amount)',
  'function deposit()',
  'function withdraw(uint256 wad)',
  'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress)',
] as const);

/** Selector lookup computed once, so decoding an unknown call costs no hashing. */
const ABI_BY_SELECTOR = new Map(ACTIVITY_ABI.map((item) => [toFunctionSelector(item), item] as const));

const HEX_INPUT = /^0x(?:[0-9a-fA-F]{2})*$/;
/** 512 KiB of calldata is far beyond any action History explains. */
const MAX_INPUT_LENGTH = 2 + 1_048_576;

/** Lower-case four-byte selector, or null when the input carries no call. */
export function callSelector(input: string | null | undefined): string | null {
  return typeof input === 'string' && /^0x[0-9a-fA-F]{8}/.test(input) ? input.slice(0, 10).toLowerCase() : null;
}

const asBigint = (value: unknown): bigint | null => typeof value === 'bigint' ? value : null;
const asAddress = (value: unknown): Address | null => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as Address : null;

/** Named tuple components decode as objects; tolerate positional arrays too. */
function tupleField(value: unknown, name: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[name] : undefined;
}

/** Decode the subset of calls History can explain. Malformed input returns null. */
export function decodeActivityCall(input: string | null | undefined): DecodedActivityCall | null {
  if (typeof input !== 'string' || input.length < 10 || input.length > MAX_INPUT_LENGTH || !HEX_INPUT.test(input)) return null;
  const item = ABI_BY_SELECTOR.get(input.slice(0, 10).toLowerCase() as Hex);
  if (!item) return null;
  let functionName: string;
  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({ abi: [item], data: input as Hex });
    functionName = decoded.functionName;
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    return null;
  }
  switch (functionName) {
    case 'openOrAddPositionFlashLoanV2':
    case 'openOrAddShortPositionFlashLoan':
    case 'closeOrRemovePositionFlashLoanV2':
    case 'closeOrRemoveShortPositionFlashLoan': {
      const pool = asAddress(args[1]);
      const positionId = asBigint(args[2]);
      if (!pool || positionId === null) return null;
      const close = functionName.startsWith('close');
      return {
        kind: 'position',
        side: functionName.includes('Short') ? 'short' : 'long',
        direction: close ? 'close' : 'open',
        pool,
        positionId,
        fullClose: close && asBigint(args[3]) === POSITION_CLOSE_SENTINEL,
      };
    }
    case 'borrowFromLong': {
      const pool = asAddress(tupleField(args[1], 'pool', 0));
      const positionId = asBigint(tupleField(args[1], 'positionId', 1));
      const borrowAmount = asBigint(tupleField(args[1], 'borrowAmount', 2));
      return pool && positionId !== null && borrowAmount !== null ? { kind: 'borrow', pool, positionId, borrowAmount } : null;
    }
    case 'repayToLong':
    case 'repayToLongAndZapOut': {
      const repayAmount = asBigint(tupleField(args[0], 'amount', 1));
      const pool = asAddress(tupleField(args[1], 'pool', 0));
      const positionId = asBigint(tupleField(args[1], 'positionId', 1));
      const withdrawAmount = asBigint(tupleField(args[1], 'withdrawAmount', 2));
      return repayAmount !== null && pool && positionId !== null && withdrawAmount !== null
        ? { kind: 'repay', pool, positionId, repayAmount, withdrawAmount, zapOut: functionName === 'repayToLongAndZapOut' }
        : null;
    }
    case 'depositToFxSave':
      return { kind: 'fxsaveDeposit', routed: true };
    case 'instantRedeemFromFxSave': {
      const amount = asBigint(args[2]);
      return amount === null ? null : { kind: 'fxsaveRedeem', instant: true, amount };
    }
    case 'deposit':
      return args.length === 0 ? { kind: 'wrap' } : { kind: 'fxsaveDeposit', routed: false };
    case 'redeem': {
      const amount = asBigint(args[0]);
      return amount === null ? null : { kind: 'fxsaveRedeem', instant: false, amount };
    }
    case 'requestRedeem': {
      const amount = asBigint(args[0]);
      return amount === null ? null : { kind: 'fxsaveRequestRedeem', amount };
    }
    case 'claim':
      return { kind: 'fxsaveClaim' };
    case 'approve': {
      const spender = asAddress(args[0]);
      const amount = asBigint(args[1]);
      return spender && amount !== null ? { kind: 'approve', spender, amount } : null;
    }
    case 'transfer': {
      const recipient = asAddress(args[0]);
      const amount = asBigint(args[1]);
      return recipient && amount !== null ? { kind: 'transfer', recipient, amount } : null;
    }
    case 'withdraw': {
      const amount = asBigint(args[0]);
      return amount === null ? null : { kind: 'unwrap', amount };
    }
    case 'send': {
      const destinationEid = tupleField(args[0], 'dstEid', 0);
      const amountLD = asBigint(tupleField(args[0], 'amountLD', 2));
      return typeof destinationEid === 'number' && amountLD !== null ? { kind: 'oftSend', destinationEid, amountLD } : null;
    }
    default:
      return null;
  }
}
