/**
 * Central session-signer policy — the broadcast allow-list (PLAN.md Pillar A §3.4).
 *
 * The session signer the user grants in the Mini App is powerful: it can sign
 * any transaction the bot hands to Privy. The ONLY thing standing between a
 * buggy/compromised route builder and the user's funds is this check. It runs
 * inside `executeRoute` — the single sanctioned broadcast path — so EVERY trade
 * (positions, earn, limit orders, automation, bridge) is screened before a
 * single byte reaches Privy.
 *
 * Invariants enforced (fail-closed):
 *  1. `tx.to` MUST be one of the small set of contracts the shipped SDK routes
 *     actually call. Merely appearing in the broader address registry is not
 *     signing authority.
 *  2. Every direct call must use a pinned SDK selector with the expected pool,
 *     token, converter, recipient/owner, and zero/native-value semantics.
 *     Unknown selectors and arbitrary payable value are always refused.
 *  3. ERC-20 and position-NFT approvals are exact-amount/id operations and
 *     must correlate to a later call in the same route (or to an authenticated
 *     speed-up of a previously screened pending transaction).
 *
 * The enforced allow-list is DERIVED FROM `ADDRESSES` at runtime, never from the
 * JSON policy file, so the two can never silently drift: `policy/signer.policy.json`
 * is documentation + the artifact PLAN.md asks for, and a unit test asserts it
 * mirrors the registry exactly.
 *
 * Mode (`SIGNER_POLICY_MODE`, default "enforce"):
 *  - "enforce" — a violation aborts the trade before broadcast (fail-closed).
 *  - "observe" — a violation is counted + surfaced but the trade proceeds.
 *    Operational safety valve: if a legitimate-but-new f(x) peripheral ever
 *    appears in a route, flip to "observe" for seconds, add the verified address
 *    to ADDRESSES, then flip back — rather than bricking trades. See docs/GAPS.md.
 *  - "off" — disabled (testing only).
 */
import { ADDRESSES } from "@fxaeon/shared";
import {
  BRIDGE_OFT_BY_TOKEN,
  CHAIN_ID_BASE,
  EID_BASE,
  EID_ETHEREUM,
} from "@aladdindao/fx-sdk";
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  isAddress,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { incr } from "./metrics.js";
import type { SupportedWalletChainId } from "./privy.js";

export type PolicyMode = "enforce" | "observe" | "off";

// ERC20 selectors whose address argument must itself be allow-listed.
const SEL_APPROVE = "0x095ea7b3"; // approve(address,uint256)
const SEL_TRANSFER = "0xa9059cbb"; // transfer(address,uint256)
const SEL_SET_APPROVAL_FOR_ALL = "0xa22cb465";
const SEL_OPEN_LONG = "0xef9e1aa7";
const SEL_CLOSE_LONG = "0xe8e9fc2a";
const SEL_OPEN_SHORT = "0x99414c10";
const SEL_CLOSE_SHORT = "0xad0acfdc";
const SEL_BORROW_LONG = "0x216d5108";
const SEL_REPAY_LONG = "0x0d8aea82";
const SEL_REPAY_LONG_ZAP = "0xbf4e5936";
const SEL_SAVE_DEPOSIT_ROUTER = "0x3ea34dc0";
const SEL_SAVE_INSTANT_REDEEM = "0x6d701088";
const SEL_ERC4626_DEPOSIT = "0x6e553f65";
const SEL_ERC4626_REDEEM = "0xba087652";
const SEL_SAVE_REQUEST_REDEEM = "0xaa2f892d";
const SEL_SAVE_CLAIM = "0x1e83409a";
const SEL_CONVERT = toFunctionSelector("convert(address,uint256,uint256,uint256[])");
const SEL_OFT_SEND = toFunctionSelector(
  "send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address)"
);

const OFT_SEND_ABI = [{
  type: "function",
  name: "send",
  stateMutability: "payable",
  inputs: [
    {
      name: "sendParam",
      type: "tuple",
      components: [
        { name: "dstEid", type: "uint32" },
        { name: "to", type: "bytes32" },
        { name: "amountLD", type: "uint256" },
        { name: "minAmountLD", type: "uint256" },
        { name: "extraOptions", type: "bytes" },
        { name: "composeMsg", type: "bytes" },
        { name: "oftCmd", type: "bytes" },
      ],
    },
    {
      name: "fee",
      type: "tuple",
      components: [
        { name: "nativeFee", type: "uint256" },
        { name: "lzTokenFee", type: "uint256" },
      ],
    },
    { name: "refundAddress", type: "address" },
  ],
  outputs: [],
}] as const;

/** Only contracts directly emitted in SDK 1.0.5 transaction arrays. */
export const ETHEREUM_SIGNING_TARGET_LABELS = Object.freeze([
  "ROUTER",
  "FX_MINT_ROUTER",
  "FXSAVE",
  "FXUSD_BASE_POOL",
  "FXUSD",
  "WSTETH",
  "WBTC",
  "STETH",
  "USDC",
  "USDT",
  "WETH",
  "WSTETH_LONG_POOL",
  "WBTC_LONG_POOL",
  "WSTETH_SHORT_POOL",
  "WBTC_SHORT_POOL",
  "FXUSD_OFT_ADAPTER",
  "FXSAVE_OFT_ADAPTER",
] as const satisfies readonly (keyof typeof ADDRESSES)[]);

/** Ethereum allow-list retained as the backward-compatible public export. */
export const ALLOWED_TARGETS: ReadonlySet<string> = new Set(
  ETHEREUM_SIGNING_TARGET_LABELS.map((label) => ADDRESSES[label].toLowerCase())
);

/** Base only permits the two SDK-pinned f(x) OFTs used by the bridge. */
export const BASE_ALLOWED_TARGETS: ReadonlySet<string> = new Set(
  Object.values(BRIDGE_OFT_BY_TOKEN).map((byChain) => byChain[CHAIN_ID_BASE].toLowerCase())
);

/**
 * Chain-scoped policy registry. An address being trusted on Ethereum never
 * makes the same (or any other) address trusted on Base, and vice versa.
 */
export const ALLOWED_TARGETS_BY_CHAIN: Readonly<
  Record<SupportedWalletChainId, ReadonlySet<string>>
> = Object.freeze({
  1: ALLOWED_TARGETS,
  8453: BASE_ALLOWED_TARGETS,
});

export function allowedTargetsForChain(
  chainId: SupportedWalletChainId = 1
): ReadonlySet<string> {
  const targets = ALLOWED_TARGETS_BY_CHAIN[chainId];
  if (!targets) {
    throw new Error(`No signer policy exists for chainId ${chainId}`);
  }
  return targets;
}

export interface PolicyTx {
  to: string;
  data: string;
  value?: bigint;
}

export interface PolicyViolation {
  index: number;
  to: string;
  reason: string;
}

export interface PolicyOptions {
  walletAddress?: string;
  /** Exact server-validated transfer authorized by one user_withdraw intent. */
  intentScopedWithdrawal?: {
    recipient: string;
    /** Null means native ETH; otherwise the exact ERC-20 contract. */
    tokenAddress: string | null;
    amount: bigint;
  };
  /** Exact server-validated bridge authorized by one user intent. */
  intentScopedBridge?: {
    sourceChainId: SupportedWalletChainId;
    tokenAddress: string;
    oftTarget: string;
    amount: bigint;
  };
  /** Policy namespace. Defaults to Ethereum for existing callers. */
  chainId?: SupportedWalletChainId;
  /** Exact persisted call being re-broadcast with the same sender + nonce. */
  intentScopedReplacement?: {
    to: string;
    data: string;
    value: bigint;
  };
}

/** Hard loss bound for a malformed/compromised LayerZero fee quote. */
export const MAX_BRIDGE_NATIVE_FEE_WEI = 100_000_000_000_000_000n; // 0.1 ETH

export class SignerPolicyError extends Error {
  constructor(public readonly violations: PolicyViolation[]) {
    super(
      `signer policy refused ${violations.length} disallowed tx(s): ` +
        violations.map((v) => `#${v.index} ${v.reason}`).join("; ")
    );
    this.name = "SignerPolicyError";
  }
}

function selectorOf(data: string | undefined): string {
  return (data ?? "").slice(0, 10).toLowerCase();
}

/** Extract the address argument at 32-byte word `wordIndex` (0-based) from calldata. */
function addressArg(data: string, wordIndex: number): string | null {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const start = 8 + wordIndex * 64; // 8 hex chars = 4-byte selector
  const word = hex.slice(start, start + 64);
  if (word.length < 64) return null;
  // An ABI address word is left-padded to 32 bytes; the address is the low 20.
  const upper = word.slice(0, 24);
  if (!/^0+$/.test(upper)) return null; // not a clean address word → suspicious
  return ("0x" + word.slice(24)).toLowerCase();
}

function uintAtByteOffset(data: string, byteOffset: number): bigint | null {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const hex = data.slice(2);
  const start = 8 + byteOffset * 2;
  const word = hex.slice(start, start + 64);
  if (word.length !== 64) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

function uintArg(data: string, wordIndex: number): bigint | null {
  return uintAtByteOffset(data, wordIndex * 32);
}

function addressFromUint(value: bigint | null): string | null {
  if (value === null || value < 0n || value >> 160n !== 0n) return null;
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function tupleUintArg(data: string, pointerWordIndex: number, tupleWordIndex: number): bigint | null {
  const pointer = uintArg(data, pointerWordIndex);
  if (pointer === null || pointer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return uintAtByteOffset(data, Number(pointer) + tupleWordIndex * 32);
}

function tupleAddressArg(data: string, pointerWordIndex: number, tupleWordIndex: number): string | null {
  return addressFromUint(tupleUintArg(data, pointerWordIndex, tupleWordIndex));
}

function dynamicBytesAtByteOffset(data: string, byteOffset: number): Hex | null {
  const length = uintAtByteOffset(data, byteOffset);
  if (length === null || length > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const lengthNumber = Number(length);
  const hex = data.slice(2);
  const start = 8 + (byteOffset + 32) * 2;
  const end = start + lengthNumber * 2;
  const paddedEnd = start + Math.ceil(lengthNumber / 32) * 64;
  if (end > hex.length || paddedEnd > hex.length || !/^0*$/.test(hex.slice(end, paddedEnd))) return null;
  return `0x${hex.slice(start, end)}` as Hex;
}

function dynamicBytesArg(data: string, pointerWordIndex: number): Hex | null {
  const pointer = uintArg(data, pointerWordIndex);
  if (pointer === null || pointer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return dynamicBytesAtByteOffset(data, Number(pointer));
}

function tupleDynamicBytes(data: string, pointerWordIndex: number, tupleWordIndex: number): Hex | null {
  const pointer = uintArg(data, pointerWordIndex);
  if (pointer === null || pointer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const relative = uintAtByteOffset(data, Number(pointer) + tupleWordIndex * 32);
  if (relative === null || relative > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return dynamicBytesAtByteOffset(data, Number(pointer) + Number(relative));
}

function uintArrayAtByteOffset(data: string, byteOffset: number): bigint[] | null {
  const length = uintAtByteOffset(data, byteOffset);
  if (length === null || length > 64n) return null;
  const values: bigint[] = [];
  for (let index = 0; index < Number(length); index++) {
    const value = uintAtByteOffset(data, byteOffset + 32 + index * 32);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function uintArrayArg(data: string, pointerWordIndex: number): bigint[] | null {
  const pointer = uintArg(data, pointerWordIndex);
  if (pointer === null || pointer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return uintArrayAtByteOffset(data, Number(pointer));
}

function tupleUintArray(data: string, pointerWordIndex: number, tupleWordIndex: number): bigint[] | null {
  const pointer = uintArg(data, pointerWordIndex);
  if (pointer === null || pointer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const relative = uintAtByteOffset(data, Number(pointer) + tupleWordIndex * 32);
  if (relative === null || relative > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return uintArrayAtByteOffset(data, Number(pointer) + Number(relative));
}

type FxRouteWords = readonly [encoding: bigint, routes: readonly bigint[]];

// Exact product-relevant ROUTER table shipped in @aladdindao/fx-sdk@1.0.5.
// Packed words contain the converter/pool path; accepting arbitrary values
// here would let a compromised quote builder choose a different conversion
// despite using the allow-listed MultiPathConverter target.
const FXR_A = 0x1fce71607d656d4f172c66f42cfe369b24d78b2810an;
const FXR_B = 0x1fce71607d656d4f172c66f42cfe369b24d78b2820an;
const FXR_C = 0x277090c5ae6b80a3c525f09d7ae464a8fa83d9c08804n;
const FXR_D = 0x2b9eae5948378e863978446d7aaac254c4b5ffa110an;
const FXR_E = 0x07d2239a830b7749bfbad93c0e68b104a5bf2cfd590001n;
const FXR_F = 0x040007d2239a830b7749bfbad93c0e68b104a5bf2cfd590001n;
const FXR_G = 0x022afaf111e0b1f6c2869832dbfa5f42d20c0cbfc71c04n;
const FXR_H = 0x014afaf111e0b1f6c2869832dbfa5f42d20c0cbfc71c04n;
const FXR_I = 0x01054062fa20b733978fcbcec244eb8825ae6cfed87c0cn;
const FXR_J = 0x254062fa20b733978fcbcec244eb8825ae6cfed87c0cn;
const FXR_K = 0x2ee266b2329c21fe928a87ed8d5c9a659688052af0d401n;
const FXR_L = 0x04002ee266b2329c21fe928a87ed8d5c9a659688052af0d401n;
const FXR_E1 = 2_097_151n;
const FXR_E2 = 3_145_727n;
const FXR_E3 = 4_194_303n;
const FXR_E4 = 5_242_879n;

const fxRouteKey = (input: string, output: string): string => `${input.toLowerCase()}>${output.toLowerCase()}`;
const FX_ROUTE_V1: ReadonlyMap<string, FxRouteWords> = new Map([
  [fxRouteKey(ADDRESSES.STETH, ADDRESSES.WSTETH), [FXR_E1, [FXR_A]]],
  [fxRouteKey(ADDRESSES.WSTETH, ADDRESSES.STETH), [FXR_E1, [FXR_B]]],
  [fxRouteKey(ADDRESSES.WSTETH, ADDRESSES.WETH), [FXR_E2, [FXR_B, FXR_C]]],
  [fxRouteKey(ADDRESSES.WSTETH, ADDRESSES.USDC), [FXR_E3, [FXR_B, FXR_C, FXR_E]]],
  [fxRouteKey(ADDRESSES.WSTETH, ADDRESSES.USDT), [FXR_E4, [FXR_B, FXR_C, FXR_E, FXR_G]]],
  [fxRouteKey(ADDRESSES.WSTETH, ADDRESSES.FXUSD), [FXR_E4, [FXR_B, FXR_C, FXR_E, FXR_I]]],
  [fxRouteKey(ADDRESSES.WETH, ADDRESSES.WSTETH), [FXR_E2, [FXR_D, FXR_A]]],
  [fxRouteKey(ADDRESSES.WETH, ADDRESSES.FXUSD), [FXR_E2, [FXR_E, FXR_I]]],
  [fxRouteKey(ADDRESSES.USDC, ADDRESSES.WSTETH), [FXR_E3, [FXR_F, FXR_D, FXR_A]]],
  [fxRouteKey(ADDRESSES.USDC, ADDRESSES.FXUSD), [FXR_E1, [FXR_I]]],
  [fxRouteKey(ADDRESSES.USDC, ADDRESSES.WBTC), [FXR_E1, [FXR_K]]],
  [fxRouteKey(ADDRESSES.USDT, ADDRESSES.WSTETH), [FXR_E4, [FXR_H, FXR_F, FXR_D, FXR_A]]],
  [fxRouteKey(ADDRESSES.USDT, ADDRESSES.WBTC), [FXR_E2, [FXR_H, FXR_K]]],
  [fxRouteKey(ADDRESSES.USDT, ADDRESSES.FXUSD), [FXR_E2, [FXR_H, FXR_I]]],
  [fxRouteKey(ADDRESSES.WBTC, ADDRESSES.USDC), [FXR_E1, [FXR_L]]],
  [fxRouteKey(ADDRESSES.WBTC, ADDRESSES.USDT), [FXR_E2, [FXR_L, FXR_G]]],
  [fxRouteKey(ADDRESSES.WBTC, ADDRESSES.FXUSD), [FXR_E2, [FXR_L, FXR_I]]],
  [fxRouteKey(ADDRESSES.FXUSD, ADDRESSES.USDC), [FXR_E1, [FXR_J]]],
  [fxRouteKey(ADDRESSES.FXUSD, ADDRESSES.USDT), [FXR_E2, [FXR_J, FXR_G]]],
  [fxRouteKey(ADDRESSES.FXUSD, ADDRESSES.WSTETH), [FXR_E4, [FXR_J, FXR_F, FXR_D, FXR_A]]],
  [fxRouteKey(ADDRESSES.FXUSD, ADDRESSES.WETH), [FXR_E2, [FXR_J, FXR_F]]],
  [fxRouteKey(ADDRESSES.FXUSD, ADDRESSES.WBTC), [FXR_E2, [FXR_J, FXR_K]]],
]);

function normalizeFxRouteToken(token: string): string {
  return token.toLowerCase() === ADDRESSES.ETH.toLowerCase()
    ? ADDRESSES.WETH.toLowerCase()
    : token.toLowerCase();
}

function matchesFxRouteV1(
  inputToken: string,
  outputToken: string,
  encoding: bigint,
  routes: readonly bigint[]
): boolean {
  const input = normalizeFxRouteToken(inputToken);
  const output = normalizeFxRouteToken(outputToken);
  if (input === output) return encoding === 0n && routes.length === 0;
  const expected = FX_ROUTE_V1.get(fxRouteKey(input, output));
  return Boolean(
    expected &&
    encoding === expected[0] &&
    routes.length === expected[1].length &&
    routes.every((route, index) => route === expected[1][index])
  );
}

function validateConverterCall(
  data: Hex | null,
  expectedToken: string,
  expectedAmount: bigint,
  expectedOutputToken: string
): string | null {
  if (!data || selectorOf(data) !== SEL_CONVERT) return "embedded converter payload is not MultiPathConverter.convert";
  if (!/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*$/.test(data)) return "embedded converter calldata is malformed";
  const token = addressArg(data, 0);
  const amount = uintArg(data, 1);
  const encoding = uintArg(data, 2);
  const routesOffset = uintArg(data, 3);
  if (token !== expectedToken || amount !== expectedAmount || routesOffset !== 128n) {
    return "embedded converter token, amount, or array offset does not match the reviewed action";
  }
  const routeCount = uintAtByteOffset(data, 128);
  if (routeCount === null || routeCount > 64n) return "embedded converter route array is invalid or too large";
  const expectedBytes = 4 + 4 * 32 + 32 + Number(routeCount) * 32;
  if ((data.length - 2) / 2 !== expectedBytes) return "embedded converter calldata has non-canonical trailing data";
  const routes = uintArrayArg(data, 3);
  if (encoding === null || !routes || !matchesFxRouteV1(expectedToken, expectedOutputToken, encoding, routes)) {
    return "embedded converter encoding/routes do not match the shipped FxRoute table";
  }
  return null;
}

function validateConvertInTuple(
  data: string,
  pointerWordIndex: number,
  token: string,
  amount: bigint,
  outputToken: string
): string | null {
  const signature = tupleDynamicBytes(data, pointerWordIndex, 5);
  if (signature !== "0x") return "convert-in permits no external signature payload";
  return validateConverterCall(tupleDynamicBytes(data, pointerWordIndex, 3), token, amount, outputToken);
}

function validateConvertOutTuple(data: string, pointerWordIndex: number, inputToken: string): string | null {
  const signature = tupleDynamicBytes(data, pointerWordIndex, 5);
  const outputToken = tupleAddressArg(data, pointerWordIndex, 0);
  const encoding = tupleUintArg(data, pointerWordIndex, 2);
  const routes = tupleUintArray(data, pointerWordIndex, 3);
  if (signature !== "0x") return "convert-out permits no external signature payload";
  if (!outputToken || encoding === null || !routes) return "convert-out route array is invalid or too large";
  if (!matchesFxRouteV1(inputToken, outputToken, encoding, routes)) {
    return "convert-out encoding/routes do not match the shipped FxRoute table";
  }
  return null;
}

function poolAsset(pool: string): string | null {
  const kind = POOL_KIND.get(pool);
  if (!kind) return null;
  return lower(kind.market === "wstETH" ? ADDRESSES.WSTETH : ADDRESSES.WBTC);
}

function validateFlashLoanCallback(
  data: string,
  pointerWordIndex: number,
  expectedInputToken: string,
  /** Null when the SDK callback word itself is the converter input amount. */
  expectedInputAmount: bigint | null,
  expectedOutputToken: string
): string | null {
  const callback = dynamicBytesArg(data, pointerWordIndex);
  if (!callback) return "flash-loan callback payload is missing";
  // Callback bytes are abi.encode(uint256,uint256,address,bytes), without a
  // selector. Prefix a dummy selector so the shared canonical ABI readers can
  // inspect it with the same offsets as function calldata.
  const encoded = `0x00000000${callback.slice(2)}`;
  const callbackAmount = uintArg(encoded, 1);
  const target = addressArg(encoded, 2);
  const nested = dynamicBytesArg(encoded, 3);
  const converterAmount = expectedInputAmount ?? callbackAmount;
  if (
    callbackAmount === null ||
    callbackAmount <= 0n ||
    converterAmount === null ||
    converterAmount <= 0n ||
    target !== CONVERTER
  ) {
    return "flash-loan callback amount or embedded target is outside protocol-native FxRoute";
  }
  return validateConverterCall(nested, expectedInputToken, converterAmount, expectedOutputToken);
}

const lower = (address: string): string => address.toLowerCase();
const ROUTER = lower(ADDRESSES.ROUTER);
const FX_MINT_ROUTER = lower(ADDRESSES.FX_MINT_ROUTER);
const FXSAVE = lower(ADDRESSES.FXSAVE);
const BASE_POOL = lower(ADDRESSES.FXUSD_BASE_POOL);
const CONVERTER = lower(ADDRESSES.MULTIPATH_CONVERTER);
const ETH_SENTINEL = lower(ADDRESSES.ETH);

const TOKEN_TARGETS: ReadonlySet<string> = new Set([
  ADDRESSES.FXUSD,
  ADDRESSES.FXSAVE,
  ADDRESSES.FXUSD_BASE_POOL,
  ADDRESSES.WSTETH,
  ADDRESSES.WBTC,
  ADDRESSES.STETH,
  ADDRESSES.USDC,
  ADDRESSES.USDT,
  ADDRESSES.WETH,
].map(lower));

type PoolKind = { market: "wstETH" | "WBTC"; side: "long" | "short" };
const POOL_KIND: ReadonlyMap<string, PoolKind> = new Map([
  [lower(ADDRESSES.WSTETH_LONG_POOL), { market: "wstETH", side: "long" }],
  [lower(ADDRESSES.WBTC_LONG_POOL), { market: "WBTC", side: "long" }],
  [lower(ADDRESSES.WSTETH_SHORT_POOL), { market: "wstETH", side: "short" }],
  [lower(ADDRESSES.WBTC_SHORT_POOL), { market: "WBTC", side: "short" }],
]);

function allowedPositionToken(pool: string, token: string): boolean {
  const kind = POOL_KIND.get(pool);
  if (!kind) return false;
  const allowed = kind.market === "wstETH"
    ? [ADDRESSES.ETH, ADDRESSES.WETH, ADDRESSES.STETH, ADDRESSES.WSTETH, ADDRESSES.USDC, ADDRESSES.USDT, ADDRESSES.FXUSD]
    : [ADDRESSES.WBTC, ADDRESSES.USDC, ADDRESSES.USDT, ADDRESSES.FXUSD];
  return allowed.some((address) => lower(address) === token);
}

interface TokenApproval {
  index: number;
  token: string;
  spender: string;
  amount: bigint;
}

interface PositionApproval {
  index: number;
  pool: string;
  operator: string;
  positionId: bigint;
}

interface ApprovalNeed {
  index: number;
  token: string;
  spender: string;
  amount: bigint;
}

interface PositionApprovalNeed {
  index: number;
  pool: string;
  operator: string;
  positionId: bigint;
}

interface CallInspection {
  reason?: string;
  tokenApproval?: Omit<TokenApproval, "index">;
  positionApproval?: Omit<PositionApproval, "index">;
  approvalNeed?: Omit<ApprovalNeed, "index">;
  positionApprovalNeed?: Omit<PositionApprovalNeed, "index">;
}

function inspectEthereumCall(tx: PolicyTx, self: string | undefined): CallInspection {
  const to = lower(tx.to);
  const data = tx.data ?? "";
  const selector = selectorOf(data);
  const value = tx.value ?? 0n;
  if (value < 0n) return { reason: "transaction value cannot be negative" };
  if (!/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*$/.test(data)) {
    return { reason: "calldata is malformed or not canonical ABI encoding" };
  }

  // ERC-20 approval. Transfers are permitted only by the exact withdrawal
  // exception checked before this function. The SDK does not emit unlimited
  // or increaseAllowance calls.
  if (TOKEN_TARGETS.has(to) && selector === SEL_APPROVE) {
    const spender = addressArg(data, 0);
    const amount = uintArg(data, 1);
    if (!spender || amount === null || amount <= 0n || amount === (1n << 256n) - 1n || value !== 0n) {
      return { reason: "token approval must be zero-value, exact, positive, and non-unlimited" };
    }
    if (![ROUTER, FX_MINT_ROUTER, FXSAVE].includes(spender) && !isOftTarget(spender, 1)) {
      return { reason: `token approval spender ${spender} is not an SDK execution target` };
    }
    return { tokenApproval: { token: to, spender, amount } };
  }

  // Position pools are ERC-721-like. The shipped SDK emits approve(position),
  // never blanket setApprovalForAll.
  if (POOL_KIND.has(to)) {
    if (selector === SEL_SET_APPROVAL_FOR_ALL) {
      return { reason: "blanket position approval is not permitted" };
    }
    if (selector !== SEL_APPROVE || value !== 0n) {
      return { reason: `position pool selector ${selector} is not permitted` };
    }
    const operator = addressArg(data, 0);
    const positionId = uintArg(data, 1);
    if (!operator || ![ROUTER, FX_MINT_ROUTER].includes(operator) || positionId === null || positionId <= 0n) {
      return { reason: "position approval has an invalid operator or token id" };
    }
    return { positionApproval: { pool: to, operator, positionId } };
  }

  if (to === ROUTER) {
    if ([SEL_OPEN_LONG, SEL_OPEN_SHORT].includes(selector)) {
      const token = tupleAddressArg(data, 0, 0);
      const amount = tupleUintArg(data, 0, 1);
      const converter = tupleAddressArg(data, 0, 2);
      const minOut = tupleUintArg(data, 0, 4);
      const pool = addressArg(data, 1);
      const positionId = uintArg(data, 2);
      const kind = pool ? POOL_KIND.get(pool) : undefined;
      const expectedSide = selector === SEL_OPEN_SHORT ? "short" : "long";
      if (!token || !pool || !kind || kind.side !== expectedSide || !allowedPositionToken(pool, token)) {
        return { reason: "position-open token/pool/side is outside the shipped SDK market" };
      }
      if (
        amount === null ||
        amount < 0n ||
        minOut === null ||
        (amount > 0n && minOut <= 0n) ||
        converter !== CONVERTER ||
        positionId === null ||
        (positionId === 0n && amount === 0n)
      ) {
        return { reason: "position-open calldata has invalid amount, converter, minimum output, or id" };
      }
      const asset = poolAsset(pool);
      if (!asset) return { reason: "position-open pool has no canonical asset" };
      const conversionOutput = expectedSide === "long" ? asset : lower(ADDRESSES.FXUSD);
      const convertViolation = validateConvertInTuple(data, 0, token, amount, conversionOutput);
      if (convertViolation) return { reason: convertViolation };
      // Fx-sdk callback directions are not symmetric: opening a long converts
      // fxUSD, while opening a short converts the borrowed market asset.
      const callbackToken = expectedSide === "long" ? lower(ADDRESSES.FXUSD) : poolAsset(pool);
      const callbackInputAmount = expectedSide === "long" ? null : uintArg(data, 3);
      const callbackViolation = callbackToken
        ? validateFlashLoanCallback(data, 4, callbackToken, callbackInputAmount, conversionOutput)
        : "position-open pool has no canonical callback asset";
      if (callbackViolation) return { reason: callbackViolation };
      const expectedValue = token === ETH_SENTINEL ? amount : 0n;
      if (value !== expectedValue) return { reason: "position-open native value does not match its encoded input" };
      return {
        approvalNeed: token === ETH_SENTINEL || amount === 0n ? undefined : { token, spender: ROUTER, amount },
        positionApprovalNeed: positionId > 0n ? { pool, operator: ROUTER, positionId } : undefined,
      };
    }

    if ([SEL_CLOSE_LONG, SEL_CLOSE_SHORT].includes(selector)) {
      const tokenOut = tupleAddressArg(data, 0, 0);
      const converter = tupleAddressArg(data, 0, 1);
      const minOut = tupleUintArg(data, 0, 4);
      const pool = addressArg(data, 1);
      const positionId = uintArg(data, 2);
      const kind = pool ? POOL_KIND.get(pool) : undefined;
      const expectedSide = selector === SEL_CLOSE_SHORT ? "short" : "long";
      if (!tokenOut || !pool || !kind || kind.side !== expectedSide || !allowedPositionToken(pool, tokenOut)) {
        return { reason: "position-close token/pool/side is outside the shipped SDK market" };
      }
      if (converter !== CONVERTER || minOut === null || minOut <= 0n || positionId === null || positionId <= 0n || value !== 0n) {
        return { reason: "position-close calldata has invalid converter, minimum output, id, or value" };
      }
      const asset = poolAsset(pool);
      if (!asset) return { reason: "position-close pool has no canonical asset" };
      const conversionInput = expectedSide === "long" ? asset : lower(ADDRESSES.FXUSD);
      const convertViolation = validateConvertOutTuple(data, 0, conversionInput);
      if (convertViolation) return { reason: convertViolation };
      // Closing a long converts the borrowed market asset; closing a short
      // converts fxUSD. For long close the converter amount is top-level word 4.
      const callbackToken = expectedSide === "long" ? poolAsset(pool) : lower(ADDRESSES.FXUSD);
      const callbackInputAmount = expectedSide === "long" ? uintArg(data, 4) : null;
      const callbackOutput = expectedSide === "long" ? lower(ADDRESSES.FXUSD) : asset;
      const callbackViolation = callbackToken
        ? validateFlashLoanCallback(data, 5, callbackToken, callbackInputAmount, callbackOutput)
        : "position-close pool has no canonical callback asset";
      if (callbackViolation) return { reason: callbackViolation };
      return { positionApprovalNeed: { pool, operator: ROUTER, positionId } };
    }

    if (selector === SEL_SAVE_DEPOSIT_ROUTER) {
      const tupleToken = tupleAddressArg(data, 0, 0);
      const amount = tupleUintArg(data, 0, 1);
      const converter = tupleAddressArg(data, 0, 2);
      const token = addressArg(data, 1);
      const minShares = uintArg(data, 2);
      const receiver = addressArg(data, 3);
      if (!self || receiver !== self || !token || token !== tupleToken || ![lower(ADDRESSES.USDC), lower(ADDRESSES.FXUSD)].includes(token)) {
        return { reason: "fxSAVE deposit token or receiver does not match the authenticated wallet" };
      }
      if (amount === null || amount <= 0n || minShares === null || minShares <= 0n || converter !== CONVERTER || value !== 0n) {
        return { reason: "fxSAVE deposit has an invalid amount, minimum shares, converter, or value" };
      }
      const convertViolation = validateConvertInTuple(data, 0, token, amount, token);
      if (convertViolation) return { reason: convertViolation };
      return { approvalNeed: { token, spender: ROUTER, amount } };
    }

    if (selector === SEL_SAVE_INSTANT_REDEEM) {
      const tokenOutA = tupleAddressArg(data, 0, 0);
      const converterA = tupleAddressArg(data, 0, 1);
      const minOutA = tupleUintArg(data, 0, 4);
      const tokenOutB = tupleAddressArg(data, 1, 0);
      const converterB = tupleAddressArg(data, 1, 1);
      const minOutB = tupleUintArg(data, 1, 4);
      const amount = uintArg(data, 2);
      const receiver = addressArg(data, 3);
      if (!self || receiver !== self || !tokenOutA || tokenOutA !== tokenOutB || ![lower(ADDRESSES.USDC), lower(ADDRESSES.FXUSD)].includes(tokenOutA)) {
        return { reason: "instant fxSAVE output or receiver is outside the reviewed action" };
      }
      if (
        converterA !== CONVERTER ||
        converterB !== CONVERTER ||
        minOutA === null ||
        minOutB === null ||
        minOutA + minOutB <= 0n ||
        amount === null ||
        amount <= 0n ||
        value !== 0n
      ) {
        return { reason: "instant fxSAVE calldata has an invalid converter, minimum output, amount, or value" };
      }
      const fxUsdConvertViolation = validateConvertOutTuple(data, 0, lower(ADDRESSES.FXUSD));
      if (fxUsdConvertViolation) return { reason: fxUsdConvertViolation };
      const usdcConvertViolation = validateConvertOutTuple(data, 1, lower(ADDRESSES.USDC));
      if (usdcConvertViolation) return { reason: usdcConvertViolation };
      return { approvalNeed: { token: FXSAVE, spender: ROUTER, amount } };
    }

    return { reason: `router selector ${selector} is not permitted` };
  }

  if (to === FX_MINT_ROUTER) {
    if (![SEL_BORROW_LONG, SEL_REPAY_LONG, SEL_REPAY_LONG_ZAP].includes(selector)) {
      return { reason: `mint-router selector ${selector} is not permitted` };
    }
    const token = tupleAddressArg(data, 0, 0);
    const amount = tupleUintArg(data, 0, 1);
    const converter = tupleAddressArg(data, 0, 2);
    const minOut = tupleUintArg(data, 0, 4);
    const pool = addressArg(data, 1);
    const positionId = uintArg(data, 2);
    const actionAmount = uintArg(data, 3);
    const kind = pool ? POOL_KIND.get(pool) : undefined;
    if (
      !token ||
      !pool ||
      !kind ||
      kind.side !== "long" ||
      converter !== CONVERTER ||
      amount === null ||
      amount < 0n ||
      minOut === null ||
      (amount > 0n && minOut <= 0n) ||
      positionId === null ||
      actionAmount === null
    ) {
      return { reason: "mint/repay calldata has an invalid long pool, amount, converter, minimum output, or id" };
    }
    const asset = poolAsset(pool);
    if (!asset) return { reason: "mint/repay pool has no canonical asset" };
    const convertViolation = validateConvertInTuple(
      data,
      0,
      token,
      amount,
      selector === SEL_BORROW_LONG ? asset : lower(ADDRESSES.FXUSD)
    );
    if (convertViolation) return { reason: convertViolation };
    if (selector === SEL_BORROW_LONG) {
      const allowedCollateral = kind.market === "wstETH"
        ? [ADDRESSES.ETH, ADDRESSES.WETH, ADDRESSES.STETH, ADDRESSES.WSTETH]
        : [ADDRESSES.WBTC];
      if (!allowedCollateral.some((address) => lower(address) === token) || actionAmount <= 0n || (positionId === 0n && amount === 0n)) {
        return { reason: "mint calldata has unsupported collateral, zero borrow, or an unfunded new position" };
      }
      const expectedValue = token === ETH_SENTINEL ? amount : 0n;
      if (value !== expectedValue) return { reason: "mint native value does not match its encoded collateral" };
    } else {
      if (
        token !== lower(ADDRESSES.FXUSD) ||
        value !== 0n ||
        positionId <= 0n ||
        (amount === 0n && actionAmount === 0n)
      ) {
        return { reason: "repay must manage an existing position with fxUSD and zero native value" };
      }
      if (selector === SEL_REPAY_LONG_ZAP) {
        const tokenOut = tupleAddressArg(data, 4, 0);
        const outputConverter = tupleAddressArg(data, 4, 1);
        const outputMin = tupleUintArg(data, 4, 4);
        const allowedOutput = kind.market === "wstETH"
          ? [ADDRESSES.ETH, ADDRESSES.WETH, ADDRESSES.STETH, ADDRESSES.WSTETH]
          : [ADDRESSES.WBTC];
        if (!tokenOut || !allowedOutput.some((address) => lower(address) === tokenOut) || outputConverter !== CONVERTER || outputMin === null || outputMin <= 0n) {
          return { reason: "repay zap-out token, converter, or minimum output is invalid" };
        }
        const outputViolation = validateConvertOutTuple(data, 4, asset);
        if (outputViolation) return { reason: outputViolation };
      }
    }
    return {
      approvalNeed: token === ETH_SENTINEL || amount === 0n ? undefined : { token, spender: FX_MINT_ROUTER, amount },
      positionApprovalNeed: positionId > 0n ? { pool, operator: FX_MINT_ROUTER, positionId } : undefined,
    };
  }

  if (to === FXSAVE) {
    if (selector === SEL_APPROVE) {
      // Handled above as the fxSAVE ERC-20 token.
      return { reason: "unreachable fxSAVE approval classification" };
    }
    if (value !== 0n) return { reason: "fxSAVE vault calls cannot carry native value" };
    if (selector === SEL_ERC4626_DEPOSIT) {
      const amount = uintArg(data, 0);
      const receiver = addressArg(data, 1);
      if (!self || receiver !== self || amount === null || amount <= 0n) return { reason: "fxSAVE vault deposit receiver or amount is invalid" };
      return { approvalNeed: { token: BASE_POOL, spender: FXSAVE, amount } };
    }
    if (selector === SEL_ERC4626_REDEEM) {
      const amount = uintArg(data, 0);
      const receiver = addressArg(data, 1);
      const owner = addressArg(data, 2);
      if (!self || receiver !== self || owner !== self || amount === null || amount <= 0n) return { reason: "fxSAVE vault redeem owner, receiver, or amount is invalid" };
      return {};
    }
    if (selector === SEL_SAVE_REQUEST_REDEEM) {
      const amount = uintArg(data, 0);
      return amount !== null && amount > 0n ? {} : { reason: "fxSAVE redemption request amount is invalid" };
    }
    if (selector === SEL_SAVE_CLAIM) {
      const receiver = addressArg(data, 0);
      return self && receiver === self ? {} : { reason: "fxSAVE claim receiver is not the authenticated wallet" };
    }
    return { reason: `fxSAVE selector ${selector} is not permitted` };
  }

  // An OFT is valid only through validateOftSend and an exact bridge scope.
  if (isOftTarget(to, 1)) return { reason: "OFT call requires an exact bridge intent" };
  if (TOKEN_TARGETS.has(to)) return { reason: `token selector ${selector} is not permitted` };
  return { reason: `target ${tx.to} is not an SDK execution target` };
}

export function resolvePolicyMode(): PolicyMode {
  const raw = (process.env.SIGNER_POLICY_MODE ?? "enforce").toLowerCase();
  if (raw === "observe") return "observe";
  if (raw === "off") return "off";
  return "enforce";
}

/**
 * Pure check — returns every violation in the route (does not throw).
 * `walletAddress` is accepted only in the exact receiver, owner, withdrawal,
 * refund, and replacement fields validated for each scoped operation below.
 */
export function checkRoute(
  txs: readonly PolicyTx[],
  opts: PolicyOptions = {}
): PolicyViolation[] {
  const self = opts.walletAddress?.toLowerCase();
  const chainId = opts.chainId ?? 1;
  const chainTargets = allowedTargetsForChain(chainId);

  const violations: PolicyViolation[] = [];
  const tokenApprovals: TokenApproval[] = [];
  const positionApprovals: PositionApproval[] = [];
  const approvalNeeds: ApprovalNeed[] = [];
  const positionApprovalNeeds: PositionApprovalNeed[] = [];
  const bridgeScope = opts.intentScopedBridge;
  if (opts.intentScopedWithdrawal) {
    const matches = txs.filter((tx) => isWithdrawException(tx, opts.intentScopedWithdrawal));
    if (txs.length !== 1 || matches.length !== 1) {
      violations.push({
        index: 0,
        to: txs[0]?.to ?? "",
        reason: "withdrawal intent must authorize exactly one transaction and one transfer",
      });
    }
  }
  if (opts.intentScopedReplacement && txs.length !== 1) {
    violations.push({
      index: 0,
      to: txs[0]?.to ?? "",
      reason: "a persisted transaction replacement must contain exactly one transaction",
    });
  }
  if (bridgeScope) {
    const token = bridgeScope.tokenAddress.toLowerCase();
    const oft = bridgeScope.oftTarget.toLowerCase();
    const canonicalBridge = canonicalBridgeMetadata(chainId, token, oft);
    if (
      bridgeScope.sourceChainId !== chainId ||
      bridgeScope.amount <= 0n ||
      !isAddress(bridgeScope.tokenAddress) ||
      !isAddress(bridgeScope.oftTarget) ||
      !canonicalBridge
    ) {
      violations.push({ index: 0, to: txs[0]?.to ?? "", reason: "bridge intent scope is invalid for this source chain" });
    }
    const sends = txs.filter(
      (tx) => tx.to.toLowerCase() === oft && selectorOf(tx.data) === SEL_OFT_SEND
    );
    if (sends.length !== 1) {
      violations.push({ index: 0, to: txs[0]?.to ?? "", reason: "bridge route must contain exactly one OFT send" });
    }
    const approvals = txs.filter(
      (tx) => tx.to.toLowerCase() === token && selectorOf(tx.data) === SEL_APPROVE
    );
    if (approvals.length > 1) {
      violations.push({ index: 0, to: txs[0]?.to ?? "", reason: "bridge route contains duplicate approvals" });
    }
  }
  txs.forEach((tx, index) => {
    const to = (tx.to ?? "").toLowerCase();

    // A replacement cancellation is an exact, zero-value self-send. A
    // speed-up must byte-match the immutable call persisted after the
    // original route passed this policy; this also safely reauthorizes an
    // intent-scoped withdrawal or OFT send without reconstructing its intent.
    const data = tx.data ?? "";
    const emptyData = data === "" || data === "0x";
    if (
      opts.intentScopedReplacement &&
      self &&
      to === self &&
      emptyData &&
      (tx.value ?? 0n) === 0n
    ) return;
    if (opts.intentScopedReplacement) {
      const scoped = opts.intentScopedReplacement;
      if (
        to === scoped.to.toLowerCase() &&
        data.toLowerCase() === scoped.data.toLowerCase() &&
        (tx.value ?? 0n) === scoped.value
      ) return;
      violations.push({ index, to, reason: "replacement does not byte-match the persisted transaction" });
      return;
    }

    // Native ETH withdrawal: the recipient comes from a short-lived,
    // Telegram-user-bound server intent. No calldata is allowed.
    if (isWithdrawException(tx, opts.intentScopedWithdrawal)) return;

    if (!chainTargets.has(to)) {
      violations.push({
        index,
        to,
        reason: `target ${tx.to} is not in the f(x) registry for chainId ${chainId}`,
      });
      return; // a disallowed target is already fatal; arg checks are moot.
    }
    const sel = selectorOf(tx.data);

    if (bridgeScope) {
      const token = bridgeScope.tokenAddress.toLowerCase();
      const oft = bridgeScope.oftTarget.toLowerCase();
      if (to !== token && to !== oft) {
        violations.push({ index, to, reason: `target ${tx.to} is outside the exact bridge intent` });
        return;
      }
      // Ethereum lockbox bridges may first approve the adapter. It must be
      // the exact requested amount — never an unlimited or over-sized grant.
      if (to === token && token !== oft) {
        const expectedApproval = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [bridgeScope.oftTarget as Address, bridgeScope.amount],
        });
        if ((tx.value ?? 0n) !== 0n || tx.data.toLowerCase() !== expectedApproval.toLowerCase()) {
          violations.push({ index, to, reason: "bridge token call is not the exact intent-scoped approval" });
        }
        return;
      }
    }

    // A bridge route is the one Base execution path and is especially
    // sensitive: an SDK regression must not be able to encode a different
    // destination/refund wallet inside an otherwise allow-listed OFT call.
    if (isOftTarget(to, chainId)) {
      const bridgeViolation = validateOftSend(tx, self, chainId, bridgeScope);
      if (bridgeViolation) violations.push({ index, to, reason: bridgeViolation });
      return;
    }

    if (chainId !== 1) {
      violations.push({ index, to, reason: `chainId ${chainId} permits only intent-scoped OFT sends` });
      return;
    }

    const inspection = inspectEthereumCall(tx, self);
    if (inspection.reason) {
      violations.push({ index, to, reason: inspection.reason });
      return;
    }
    if (inspection.tokenApproval) tokenApprovals.push({ index, ...inspection.tokenApproval });
    if (inspection.positionApproval) positionApprovals.push({ index, ...inspection.positionApproval });
    if (inspection.approvalNeed) approvalNeeds.push({ index, ...inspection.approvalNeed });
    if (inspection.positionApprovalNeed) positionApprovalNeeds.push({ index, ...inspection.positionApprovalNeed });
  });

  // A speed-up replays one exact call persisted from a previously screened
  // route. Other routes must bind each approval to one later SDK action.
  if (!bridgeScope && !opts.intentScopedReplacement) {
    // One reviewed logical action may contain up to two leading, correlated
    // approvals and exactly one terminal SDK call. Without this grammar a
    // duplicated redeem/borrow/router call could spend multiple times while
    // consuming only one confirmation and one daily-cap slot.
    if (!opts.intentScopedWithdrawal && violations.length === 0) {
      const approvalCount = tokenApprovals.length + positionApprovals.length;
      const terminalCount = txs.length - approvalCount;
      if (txs.length > 3 || terminalCount !== 1) {
        violations.push({
          index: 0,
          to: txs[0]?.to ?? "",
          reason: "an SDK route must contain at most two correlated approvals and exactly one terminal action",
        });
      }
    }
    const unusedTokenNeeds = approvalNeeds.map((need) => ({ ...need, used: false }));
    for (const approval of tokenApprovals) {
      const match = unusedTokenNeeds.find(
        (need) =>
          !need.used &&
          approval.index < need.index &&
          need.token === approval.token &&
          need.spender === approval.spender &&
          need.amount === approval.amount
      );
      if (!match) {
        violations.push({
          index: approval.index,
          to: approval.token,
          reason: "token approval is not the exact amount required by this SDK route",
        });
      } else {
        match.used = true;
      }
    }

    const unusedPositionNeeds = positionApprovalNeeds.map((need) => ({ ...need, used: false }));
    for (const approval of positionApprovals) {
      const match = unusedPositionNeeds.find(
        (need) =>
          !need.used &&
          approval.index < need.index &&
          need.pool === approval.pool &&
          need.operator === approval.operator &&
          need.positionId === approval.positionId
      );
      if (!match) {
        violations.push({
          index: approval.index,
          to: approval.pool,
          reason: "position approval is not the exact position required by this SDK route",
        });
      } else {
        match.used = true;
      }
    }
  }
  return violations;
}

/**
 * Identify a dormant fee-collector send for diagnostics. It is intentionally
 * NOT an executor exception: the current product does not charge this fee.
 */
export function isFeeCollectorSend(tx: PolicyTx): boolean {
  const to = (tx.to ?? "").toLowerCase();
  const feeCollector = ADDRESSES.FEE_COLLECTOR?.toLowerCase();
  if (!feeCollector) return false;
  // Value-only: non-zero value, empty or "0x" calldata
  const data = tx.data ?? "";
  const isEmpty = data === "" || data === "0x";
  return to === feeCollector && isEmpty && (tx.value ?? 0n) > 0n;
}

/**
 * Check whether a tx is an intent-scoped user_withdraw exception.
 * Phase 3: the /withdraw flow (Phase 4) needs to send ETH or ERC-20 to
 * an address NOT in the registry. The caller must prove this tx carries
 * a valid withdraw intent before calling assertRouteAllowed.
 */
export function isWithdrawException(
  tx: PolicyTx,
  scope?: PolicyOptions["intentScopedWithdrawal"]
): boolean {
  if (!scope || scope.amount <= 0n || !isAddress(scope.recipient)) return false;
  const to = (tx.to ?? "").toLowerCase();
  const recipient = scope.recipient.toLowerCase();
  const data = tx.data ?? "";
  if (scope.tokenAddress === null) {
    const emptyData = data === "" || data === "0x";
    return to === recipient && emptyData && (tx.value ?? 0n) === scope.amount;
  }
  if (!isAddress(scope.tokenAddress) || to !== scope.tokenAddress.toLowerCase() || (tx.value ?? 0n) !== 0n) {
    return false;
  }
  const expected = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [scope.recipient as Address, scope.amount],
  });
  return data.toLowerCase() === expected.toLowerCase();
}

function isOftTarget(to: string, chainId: SupportedWalletChainId): boolean {
  return Object.values(BRIDGE_OFT_BY_TOKEN).some(
    (byChain) => byChain[chainId].toLowerCase() === to
  );
}

const BRIDGE_AMOUNT_GRANULARITY_WEI = 100_000_000_000_000n; // SDK 1.0.5 credits four decimals.
const BRIDGE_OPTIONS = Object.freeze({
  fxUSD: "0x0003",
  fxSAVE: "0x000301001101000000000000000000000000000249f0",
});

function canonicalBridgeMetadata(
  chainId: SupportedWalletChainId,
  token: string,
  oft: string
): { extraOptions: Hex } | null {
  const normalizedToken = token.toLowerCase();
  const normalizedOft = oft.toLowerCase();
  for (const key of ["fxUSD", "fxSAVE"] as const) {
    const canonicalOft = BRIDGE_OFT_BY_TOKEN[key][chainId].toLowerCase();
    const canonicalToken = chainId === 1
      ? lower(key === "fxUSD" ? ADDRESSES.FXUSD : ADDRESSES.FXSAVE)
      : canonicalOft;
    if (normalizedOft === canonicalOft && normalizedToken === canonicalToken) {
      return { extraOptions: BRIDGE_OPTIONS[key] as Hex };
    }
  }
  return null;
}

/** Validate the recipient-bearing fields inside LayerZero OFT.send calldata. */
function validateOftSend(
  tx: PolicyTx,
  walletAddress: string | undefined,
  chainId: SupportedWalletChainId,
  scope: PolicyOptions["intentScopedBridge"]
): string | null {
  if (!scope) return "OFT send requires an exact bridge intent";
  if (scope.sourceChainId !== chainId) return "bridge intent source chain does not match signer policy";
  if (tx.to.toLowerCase() !== scope.oftTarget.toLowerCase()) return "OFT target does not match the bridge intent";
  const canonical = canonicalBridgeMetadata(
    chainId,
    scope.tokenAddress.toLowerCase(),
    scope.oftTarget.toLowerCase()
  );
  if (!canonical) return "bridge token and OFT target are not a canonical SDK pair";
  if (!walletAddress || !isAddress(walletAddress)) return "OFT send requires the authenticated wallet";
  if (selectorOf(tx.data) !== SEL_OFT_SEND) return "OFT target only permits send calldata";
  try {
    const decoded = decodeFunctionData({ abi: OFT_SEND_ABI, data: tx.data as Hex });
    if (decoded.functionName !== "send") return "OFT calldata is not send";
    const [sendParam, fee, refundAddress] = decoded.args;
    const expectedRecipient = `0x${walletAddress.slice(2).toLowerCase().padStart(64, "0")}`;
    const expectedDestination = chainId === 1 ? EID_BASE : EID_ETHEREUM;
    if (sendParam.dstEid !== expectedDestination) return "OFT destination chain does not match the source chain";
    if (sendParam.to.toLowerCase() !== expectedRecipient) return "OFT recipient is not the authenticated wallet";
    if (refundAddress.toLowerCase() !== walletAddress) return "OFT refund address is not the authenticated wallet";
    if (sendParam.amountLD !== scope.amount) return "OFT amount does not match the bridge intent";
    const expectedMinAmount = scope.amount / BRIDGE_AMOUNT_GRANULARITY_WEI * BRIDGE_AMOUNT_GRANULARITY_WEI;
    if (scope.amount < BRIDGE_AMOUNT_GRANULARITY_WEI || sendParam.minAmountLD !== expectedMinAmount) {
      return "OFT minimum amount does not match the SDK four-decimal credit bound";
    }
    if (sendParam.extraOptions.toLowerCase() !== canonical.extraOptions.toLowerCase()) {
      return "OFT execution options do not match the canonical token route";
    }
    if (sendParam.composeMsg !== "0x" || sendParam.oftCmd !== "0x") {
      return "OFT compose/command payloads are not permitted";
    }
    if (fee.lzTokenFee !== 0n) return "OFT LZ-token fees are not permitted";
    if (fee.nativeFee > MAX_BRIDGE_NATIVE_FEE_WEI) return "OFT native fee exceeds the safety cap";
    if ((tx.value ?? 0n) !== fee.nativeFee) return "OFT native value does not match its encoded fee";
    return null;
  } catch {
    return "OFT send calldata could not be decoded";
  }
}

/**
 * Enforce the policy for a route. Throws `SignerPolicyError` in "enforce" mode
 * when there is any violation; in "observe" mode it counts + returns the
 * violations (caller logs); in "off" mode it is a no-op.
 */
export function assertRouteAllowed(
  txs: readonly PolicyTx[],
  opts: PolicyOptions & { mode?: PolicyMode } = {}
): PolicyViolation[] {
  const mode = opts.mode ?? resolvePolicyMode();
  if (mode === "off") return [];
  const violations = checkRoute(txs, opts);
  if (violations.length === 0) {
    incr("policy.ok");
    return [];
  }
  incr("policy.violation", violations.length);
  if (mode === "observe") {
    incr("policy.observe");
    return violations;
  }
  incr("policy.reject");
  throw new SignerPolicyError(violations);
}
