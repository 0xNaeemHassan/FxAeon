/**
 * f(x) Protocol limit orders — EIP-712 order construction, hashing, relay and cancellation.
 *
 * Every constant in this file is sourced from verified artifacts:
 * - Contract: LimitOrderManager proxy 0x112873b395B98287F3A4db266a58e2D01779Ad96, listed in
 *   AladdinDAO/fx-protocol-contracts `ignition/deployments/upgrade-20251014/deployed_addresses.json`
 *   (deployed at block 23576162) and in the official f(x) docs ("LimitOrderManager contracts").
 * - EIP-712 domain: `__EIP712_init("f(x) Limit Order Manager", "1")` (LimitOrderManager.sol),
 *   cross-checked against the live contract's `eip712Domain()`.
 * - Order struct/typehash: OrderLibrary.sol `LIMIT_ORDER_TYPEHASH`. Our local
 *   `hashTypedData` output is asserted equal to the live contract's `getOrderHash()` in tests.
 * - Relay API: https://fx-limit-order-api.aladdin.club (official f(x) docs, "Limit Order APIs").
 *
 * Sign conventions enforced by the contract (OrderLibrary.validateOrder):
 * - Stop orders (orderType=true) always close: all deltas must be <= 0.
 * - Limit open orders (orderType=false, orderSide=true): all deltas must be >= 0.
 * - Limit close orders (orderType=false, orderSide=false): all deltas must be <= 0.
 * - Once signed, an order can only be cancelled ON-CHAIN (cancelOrder / increaseNonce).
 */

import {
  encodeFunctionData,
  hashTypedData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { z } from "zod";
import { ADDRESSES } from "@fxaeon/shared";

/* ------------------------------------------------------------------ */
/* EIP-712 constants (verified — see file header)                      */
/* ------------------------------------------------------------------ */

export const LIMIT_ORDER_MANAGER = ADDRESSES.LIMIT_ORDER_MANAGER as Address;

export const LIMIT_ORDER_DOMAIN = {
  name: "f(x) Limit Order Manager",
  version: "1",
  chainId: 1,
  verifyingContract: LIMIT_ORDER_MANAGER,
} as const;

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "pool", type: "address" },
    { name: "positionId", type: "uint256" },
    { name: "positionSide", type: "bool" },
    { name: "orderType", type: "bool" },
    { name: "orderSide", type: "bool" },
    { name: "allowPartialFill", type: "bool" },
    { name: "triggerPrice", type: "uint256" },
    { name: "fxUSDDelta", type: "int256" },
    { name: "collDelta", type: "int256" },
    { name: "debtDelta", type: "int256" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** keccak256 of the exact type string in OrderLibrary.sol. Asserted in tests. */
export const LIMIT_ORDER_TYPEHASH =
  "0x9e3b7d448a146e531b00ec9f19554b0566d7633e6443a66da682b643c3267cd5" as const;

/** All money fields are bigint wei. No floats anywhere near signing. */
export interface FxLimitOrder {
  maker: Address;
  pool: Address;
  positionId: bigint;
  /** true = long pool, false = short pool */
  positionSide: boolean;
  /** false = limit order, true = stop (TP/SL, always a close) */
  orderType: boolean;
  /**
   * For limit orders (orderType=false): true = open (fills when oracle <= trigger),
   * false = close (fills when oracle >= trigger).
   * For stop orders (orderType=true): true = take-profit (oracle >= trigger),
   * false = stop-loss (oracle <= trigger).
   */
  orderSide: boolean;
  allowPartialFill: boolean;
  /** Oracle anchor price, 18 decimals. Must be non-zero for stop orders. */
  triggerPrice: bigint;
  fxUSDDelta: bigint;
  collDelta: bigint;
  debtDelta: bigint;
  /** Must equal the maker's current on-chain nonce at fill time. */
  nonce: bigint;
  salt: Hex;
  /** Unix seconds. */
  deadline: bigint;
}

/* ------------------------------------------------------------------ */
/* Minimal verified ABI (hand-derived from ILimitOrderManager.sol)     */
/* ------------------------------------------------------------------ */

const ORDER_TUPLE = {
  type: "tuple",
  components: ORDER_TYPES.Order.map((f) => ({ name: f.name, type: f.type })),
} as const;

export const LIMIT_ORDER_MANAGER_ABI = [
  {
    name: "getOrderHash",
    type: "function",
    stateMutability: "view",
    inputs: [{ ...ORDER_TUPLE, name: "order" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "nonces",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getExecution",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "filled", type: "uint128" },
          { name: "positionId", type: "uint32" },
        ],
      },
    ],
  },
  {
    name: "cancelOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ ...ORDER_TUPLE, name: "order" }],
    outputs: [],
  },
  {
    name: "increaseNonce",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Order construction & validation                                     */
/* ------------------------------------------------------------------ */

/** Mirrors OrderLibrary.validateOrder delta-sign rules so we fail before signing, not at fill. */
export function validateOrderDeltas(order: FxLimitOrder): void {
  const nonPositive = (v: bigint, f: string) => {
    if (v > 0n) throw new Error(`${f} must be <= 0 for this order mode`);
  };
  const nonNegative = (v: bigint, f: string) => {
    if (v < 0n) throw new Error(`${f} must be >= 0 for this order mode`);
  };
  if (order.orderType) {
    // stop orders always close
    nonPositive(order.fxUSDDelta, "fxUSDDelta");
    nonPositive(order.debtDelta, "debtDelta");
    nonPositive(order.collDelta, "collDelta");
    if (order.triggerPrice === 0n) throw new Error("stop orders require a non-zero triggerPrice");
  } else if (order.orderSide) {
    nonNegative(order.fxUSDDelta, "fxUSDDelta");
    nonNegative(order.debtDelta, "debtDelta");
    nonNegative(order.collDelta, "collDelta");
  } else {
    nonPositive(order.fxUSDDelta, "fxUSDDelta");
    nonPositive(order.debtDelta, "debtDelta");
    nonPositive(order.collDelta, "collDelta");
  }
  if (order.deadline <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("order deadline is already in the past");
  }
}

/** Random 32-byte salt via Web Crypto (available in Node >= 19 and Bun). */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/** Local EIP-712 digest — must equal the contract's getOrderHash (asserted in tests). */
export function hashOrder(order: FxLimitOrder): Hex {
  return hashTypedData({
    domain: LIMIT_ORDER_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
  });
}

/** Full typed-data payload for a wallet `signTypedData` call (Privy, viem, ethers). */
export function buildSignPayload(order: FxLimitOrder) {
  validateOrderDeltas(order);
  return {
    domain: LIMIT_ORDER_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order" as const,
    message: order,
  };
}

/** Recover the signer and require it to be the order's maker. */
export async function verifyOrderSignature(order: FxLimitOrder, signature: Hex): Promise<boolean> {
  const recovered = await recoverTypedDataAddress({
    domain: LIMIT_ORDER_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: order,
    signature,
  });
  return recovered.toLowerCase() === order.maker.toLowerCase();
}

/* ------------------------------------------------------------------ */
/* On-chain reads (verification gate before relaying)                  */
/* ------------------------------------------------------------------ */

export async function getMakerNonce(client: PublicClient, maker: Address): Promise<bigint> {
  return client.readContract({
    address: LIMIT_ORDER_MANAGER,
    abi: LIMIT_ORDER_MANAGER_ABI,
    functionName: "nonces",
    args: [maker],
  });
}

/**
 * Cross-check our local digest against the contract's own getOrderHash.
 * Fails closed: any mismatch or RPC error means the order must NOT be signed/relayed.
 */
export async function assertOrderHashMatchesChain(
  client: PublicClient,
  order: FxLimitOrder
): Promise<Hex> {
  const local = hashOrder(order);
  const onchain = await client.readContract({
    address: LIMIT_ORDER_MANAGER,
    abi: LIMIT_ORDER_MANAGER_ABI,
    functionName: "getOrderHash",
    args: [order],
  });
  if (onchain !== local) {
    throw new Error(`order hash mismatch: local ${local} != on-chain ${onchain}`);
  }
  return local;
}

export interface OrderExecution {
  status: number;
  filled: bigint;
  positionId: number;
}

export async function getExecution(client: PublicClient, orderHash: Hex): Promise<OrderExecution> {
  const exec = await client.readContract({
    address: LIMIT_ORDER_MANAGER,
    abi: LIMIT_ORDER_MANAGER_ABI,
    functionName: "getExecution",
    args: [orderHash],
  });
  return { status: exec.status, filled: exec.filled, positionId: exec.positionId };
}

/* ------------------------------------------------------------------ */
/* Cancellation calldata (orders can only be cancelled on-chain)       */
/* ------------------------------------------------------------------ */

export function buildCancelOrderTx(order: FxLimitOrder): { to: Address; data: Hex; value: bigint } {
  return {
    to: LIMIT_ORDER_MANAGER,
    data: encodeFunctionData({
      abi: LIMIT_ORDER_MANAGER_ABI,
      functionName: "cancelOrder",
      args: [order],
    }),
    value: 0n,
  };
}

/** Bumps the maker's nonce — invalidates ALL open orders signed with the old nonce. */
export function buildIncreaseNonceTx(): { to: Address; data: Hex; value: bigint } {
  return {
    to: LIMIT_ORDER_MANAGER,
    data: encodeFunctionData({ abi: LIMIT_ORDER_MANAGER_ABI, functionName: "increaseNonce" }),
    value: 0n,
  };
}

/* ------------------------------------------------------------------ */
/* Official relay API client                                           */
/* ------------------------------------------------------------------ */

export const LIMIT_ORDER_API_BASE = "https://fx-limit-order-api.aladdin.club";

const relayResponseSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
  result: z.unknown().optional(),
});

/** JSON-serializable wire form of an order (bigints as decimal strings, per the relay schema). */
export function toWireOrder(order: FxLimitOrder) {
  return {
    maker: order.maker,
    pool: order.pool,
    positionId: Number(order.positionId),
    positionSide: order.positionSide,
    orderType: order.orderType,
    orderSide: order.orderSide,
    allowPartialFill: order.allowPartialFill,
    triggerPrice: order.triggerPrice.toString(),
    fxUSDDelta: order.fxUSDDelta.toString(),
    collDelta: order.collDelta.toString(),
    debtDelta: order.debtDelta.toString(),
    nonce: Number(order.nonce),
    salt: order.salt,
    deadline: Number(order.deadline),
  };
}

async function relayFetch(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<unknown> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${LIMIT_ORDER_API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
      const body: unknown = await res.json();
      // 4xx = our request is wrong; retrying will not help.
      if (!res.ok && res.status < 500) {
        throw new RelayRejectedError(`relay rejected request (${res.status}): ${JSON.stringify(body)}`);
      }
      if (!res.ok) throw new Error(`relay ${res.status}`);
      return body;
    } catch (error) {
      if (error instanceof RelayRejectedError) throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, attempt * 500 + jitter));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`limit order relay unreachable after ${maxAttempts} attempts: ${String(lastError)}`);
}

export class RelayRejectedError extends Error {}

/**
 * Submit a signed order to the official f(x) relay (POST /v1/order).
 * Call `assertOrderHashMatchesChain` + `verifyOrderSignature` first — this function does both
 * again defensively and fails closed.
 */
export async function relayOrder(
  client: PublicClient,
  order: FxLimitOrder,
  signature: Hex
): Promise<{ orderHash: Hex }> {
  validateOrderDeltas(order);
  if (!(await verifyOrderSignature(order, signature))) {
    throw new Error("signature does not recover to order.maker — refusing to relay");
  }
  const orderHash = await assertOrderHashMatchesChain(client, order);
  const body = await relayFetch("/v1/order", {
    method: "POST",
    body: JSON.stringify({ orderHash, data: toWireOrder(order), signature }),
  });
  const parsed = relayResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error(`unexpected relay response shape: ${JSON.stringify(body)}`);
  if (parsed.data.statusCode !== 0) {
    throw new RelayRejectedError(`relay rejected order: ${parsed.data.message}`);
  }
  return { orderHash };
}

/** Poll order state changes from the relay (GET /v1/order-updates). */
export async function fetchOrderUpdates(afterUnixSeconds?: number, limit = 100): Promise<unknown[]> {
  const params = new URLSearchParams();
  if (afterUnixSeconds !== undefined) params.set("after", String(afterUnixSeconds));
  params.set("limit", String(limit));
  const body = await relayFetch(`/v1/order-updates?${params.toString()}`);
  const parsed = relayResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.statusCode !== 0) {
    throw new Error(`unexpected order-updates response: ${JSON.stringify(body)}`);
  }
  return Array.isArray(parsed.data.result) ? parsed.data.result : [];
}
