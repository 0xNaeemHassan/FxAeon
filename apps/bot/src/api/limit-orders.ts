/**
 * Limit order API — prepare, submit, status and cancel-calldata endpoints.
 *
 * Flow (per official f(x) docs, "Integrating the f(x) limit orders"):
 * 1. POST /prepare  — server builds the full Order (real on-chain nonce, random salt),
 *    validates delta sign conventions, cross-checks the EIP-712 digest against the live
 *    contract's getOrderHash, and returns the typed-data payload for wallet signing.
 * 2. Client signs the typed data with the maker's wallet (Privy signTypedData).
 * 3. POST /submit   — server verifies the signature recovers to the maker, re-checks the
 *    digest on-chain, relays to the official f(x) relay API, and records the order.
 * 4. Cancellation is ON-CHAIN ONLY: POST /cancel-tx returns calldata for cancelOrder /
 *    increaseNonce that the maker signs and broadcasts.
 *
 * Everything fails closed: any validation, RPC or hash-mismatch error aborts the request.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { prisma } from "@fxaeon/db";
import { ADDRESSES } from "@fxaeon/shared";
import { ValidationError, SimulationError, asyncHandler } from "../middleware/errors.js";
import { createPublicClientForUser } from "../fx/index.js";
import { verifyInitData } from "./miniapp.js";
import { getConfig } from "../middleware/config.js";
import { botLogger } from "../middleware/logger.js";
import {
  type FxLimitOrder,
  buildSignPayload,
  buildCancelOrderTx,
  buildIncreaseNonceTx,
  getExecution,
  getMakerNonce,
  assertOrderHashMatchesChain,
  randomSalt,
  relayOrder,
  toWireOrder,
  RelayRejectedError,
} from "../fx/limitOrders.js";

export const limitOrdersRouter = Router();

interface LimitOrderRequest extends Request {
  limitOrderUser?: { id: string; walletAddress: string };
}

/**
 * Limit-order preparation/relay used to be anonymously reachable. Even though
 * signatures were verified, that exposed our RPC and relay as a public proxy
 * and let callers prepare orders for arbitrary makers. Bind every route to a
 * fresh Telegram Mini App signature and the matching database wallet.
 */
limitOrdersRouter.use(async (req: LimitOrderRequest, res: Response, next: NextFunction) => {
  const match = /^tma (.+)$/i.exec(req.header("authorization") ?? "");
  const verified = match ? verifyInitData(match[1], getConfig().TELEGRAM_BOT_TOKEN) : null;
  if (!verified) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Valid Telegram Mini App authentication is required." } });
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { telegramId: verified.telegramId },
      select: { id: true, walletAddress: true },
    });
    if (!user) {
      res.status(404).json({ error: { code: "NOT_ONBOARDED", message: "Finish wallet setup first." } });
      return;
    }
    req.limitOrderUser = user;
    next();
  } catch (error) {
    next(error);
  }
});

function requireAuthenticatedMaker(req: LimitOrderRequest, maker: string): void {
  const expected = req.limitOrderUser?.walletAddress;
  if (!expected || maker.toLowerCase() !== expected.toLowerCase()) {
    throw new ValidationError("order maker must match the authenticated wallet");
  }
}

const KNOWN_POOLS: ReadonlySet<string> = new Set(
  [
    ADDRESSES.WSTETH_LONG_POOL,
    ADDRESSES.WBTC_LONG_POOL,
    ADDRESSES.WSTETH_SHORT_POOL,
    ADDRESSES.WBTC_SHORT_POOL,
  ].map((a) => a.toLowerCase())
);

const addressSchema = z.string().refine(isAddress, "invalid address");
const UINT256_MAX = (1n << 256n) - 1n;
const INT256_MAX = (1n << 255n) - 1n;
const INT256_MIN = -(1n << 255n);
const intString = z.string()
  .max(79, "must fit int256")
  .regex(/^-?[0-9]+$/, "must be an integer string (wei)")
  .refine((value) => {
    if (value.length > 79 || !/^-?[0-9]+$/.test(value)) return false;
    const n = BigInt(value);
    return n >= INT256_MIN && n <= INT256_MAX;
  }, "must fit int256");
const uintString = z.string()
  .max(78, "must fit uint256")
  .regex(/^[0-9]+$/, "must be a non-negative integer string (wei)")
  .refine(
    (value) => value.length <= 78 && /^[0-9]+$/.test(value) && BigInt(value) <= UINT256_MAX,
    "must fit uint256"
  );
const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex string");

const prepareSchema = z.object({
  maker: addressSchema,
  pool: addressSchema,
  positionId: z.coerce.number().int().safe().min(0),
  positionSide: z.boolean(),
  orderType: z.boolean(),
  orderSide: z.boolean(),
  allowPartialFill: z.boolean(),
  /** Oracle anchor price with 18 decimals, as integer string. */
  triggerPrice: uintString,
  fxUSDDelta: intString,
  collDelta: intString,
  debtDelta: intString,
  /** Unix seconds; defaults to 7 days from now, capped at 30 days. */
  deadline: z.coerce.number().int().safe().positive().optional(),
});

const wireOrderSchema = z.object({
  maker: addressSchema,
  pool: addressSchema,
  positionId: z.coerce.number().int().safe().min(0),
  positionSide: z.boolean(),
  orderType: z.boolean(),
  orderSide: z.boolean(),
  allowPartialFill: z.boolean(),
  triggerPrice: uintString,
  fxUSDDelta: intString,
  collDelta: intString,
  debtDelta: intString,
  nonce: z.coerce.number().int().safe().min(0),
  salt: bytes32Schema,
  deadline: z.coerce.number().int().safe().positive(),
});

const submitSchema = z.object({
  order: wireOrderSchema,
  // Standard ECDSA r || s || v signature (65 bytes). Bounding this prevents
  // oversized attacker-controlled blobs from reaching recovery and relay.
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "signature must be 65-byte hex"),
});

function toFxOrder(wire: z.infer<typeof wireOrderSchema>): FxLimitOrder {
  return {
    maker: wire.maker as Address,
    pool: wire.pool as Address,
    positionId: BigInt(wire.positionId),
    positionSide: wire.positionSide,
    orderType: wire.orderType,
    orderSide: wire.orderSide,
    allowPartialFill: wire.allowPartialFill,
    triggerPrice: BigInt(wire.triggerPrice),
    fxUSDDelta: BigInt(wire.fxUSDDelta),
    collDelta: BigInt(wire.collDelta),
    debtDelta: BigInt(wire.debtDelta),
    nonce: BigInt(wire.nonce),
    salt: wire.salt as Hex,
    deadline: BigInt(wire.deadline),
  };
}

function requireKnownPool(pool: string): void {
  if (!KNOWN_POOLS.has(pool.toLowerCase())) {
    throw new ValidationError(`unknown pool ${pool}; expected one of the verified f(x) pools`);
  }
}

const MAX_DEADLINE_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_DEADLINE_SECONDS = 7 * 24 * 60 * 60;

limitOrdersRouter.post("/prepare", asyncHandler(async (req: LimitOrderRequest, res) => {
  const parsed = prepareSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const input = parsed.data;
  requireAuthenticatedMaker(req, input.maker);
  requireKnownPool(input.pool);

  const now = Math.floor(Date.now() / 1000);
  const deadline = input.deadline ?? now + DEFAULT_DEADLINE_SECONDS;
  if (deadline <= now || deadline > now + MAX_DEADLINE_SECONDS) {
    throw new ValidationError(`deadline must be in the future and at most 30 days out`);
  }

  try {
    const client = createPublicClientForUser("off");
    const nonce = await getMakerNonce(client, input.maker as Address);
    const order: FxLimitOrder = {
      ...toFxOrder({ ...input, nonce: 0, salt: randomSalt(), deadline }),
      nonce,
    };
    // Throws on bad delta signs / past deadline — same rules the contract enforces.
    const typedData = buildSignPayload(order);
    // Fail-closed cross-check against the live contract.
    const orderHash = await assertOrderHashMatchesChain(client, order);

    res.json({
      success: true,
      orderHash,
      order: toWireOrder(order),
      typedData: JSON.parse(
        JSON.stringify(typedData, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))
      ) as unknown,
    });
  } catch (error: unknown) {
    if (error instanceof ValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SimulationError(`failed to prepare limit order: ${message}`);
  }
}));

limitOrdersRouter.post("/submit", asyncHandler(async (req: LimitOrderRequest, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const order = toFxOrder(parsed.data.order);
  requireAuthenticatedMaker(req, order.maker);
  requireKnownPool(order.pool);
  const now = Math.floor(Date.now() / 1000);
  if (order.deadline <= BigInt(now) || order.deadline > BigInt(now + MAX_DEADLINE_SECONDS)) {
    throw new ValidationError("deadline must be in the future and at most 30 days out");
  }

  try {
    const client = createPublicClientForUser("off");
    // relayOrder re-validates deltas, verifies sig recovery and re-checks the hash on-chain.
    const { orderHash } = await relayOrder(client, order, parsed.data.signature as Hex);

    // Authentication already bound maker to this exact user. Use that id
    // directly: a case-sensitive address lookup could miss an equivalent
    // checksummed/lowercase address after the relay accepted the order.
    await prisma.limitOrder
        .upsert({
          where: { orderHash },
          update: { status: "open" },
          create: {
            userId: req.limitOrderUser!.id,
            orderHash,
            status: "open",
            positionSide: order.positionSide,
            orderType: order.orderType,
            orderSide: order.orderSide,
            triggerPrice: order.triggerPrice.toString(),
            pool: order.pool,
            fxUSDDelta: order.fxUSDDelta.toString(),
            collDelta: order.collDelta.toString(),
            debtDelta: order.debtDelta.toString(),
            nonce: order.nonce.toString(),
            salt: order.salt,
            deadline: new Date(Number(order.deadline) * 1000),
            expiresAt: new Date(Number(order.deadline) * 1000),
          },
        })
        .catch((dbError: unknown) => {
          // Order is already live on the relay — log, never fake a failure.
          botLogger.error({ err: dbError, orderHash }, "limit-orders: failed to record relayed order");
        });

    res.json({ success: true, orderHash });
  } catch (error: unknown) {
    if (error instanceof RelayRejectedError) {
      botLogger.warn({ err: error }, "limit-orders: relay rejected signed order");
      throw new ValidationError("the order relay rejected this signed order");
    }
    if (error instanceof ValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SimulationError(`failed to submit limit order: ${message}`);
  }
}));

limitOrdersRouter.get("/status/:orderHash", asyncHandler(async (req: LimitOrderRequest, res) => {
  const orderHash = req.params.orderHash;
  if (!/^0x[0-9a-fA-F]{64}$/.test(orderHash)) {
    throw new ValidationError("orderHash must be a 0x-prefixed 32-byte hex string");
  }
  // Do not expose the chain RPC as an authenticated-but-arbitrary hash proxy.
  // Status reads are limited to orders recorded for this exact Telegram user.
  const tracked = await prisma.limitOrder.findUnique({
    where: { orderHash },
    select: { userId: true },
  });
  if (!tracked || tracked.userId !== req.limitOrderUser!.id) {
    res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found." } });
    return;
  }
  try {
    const client = createPublicClientForUser("off");
    const execution = await getExecution(client, orderHash as Hex);
    res.json({
      success: true,
      orderHash,
      execution: {
        status: execution.status,
        filled: execution.filled.toString(),
        positionId: execution.positionId,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SimulationError(`failed to read order execution: ${message}`);
  }
}));

const cancelSchema = z.object({
  /** Cancel a single order (full order struct required by the contract)... */
  order: wireOrderSchema.optional(),
  /** ...or cancel ALL open orders by bumping the maker nonce. */
  cancelAll: z.boolean().optional(),
});

limitOrdersRouter.post("/cancel-tx", (req: LimitOrderRequest, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  if (parsed.data.cancelAll) {
    const tx = buildIncreaseNonceTx();
    res.json({ success: true, kind: "increaseNonce", tx: { to: tx.to, data: tx.data, value: "0" } });
    return;
  }
  if (!parsed.data.order) {
    throw new ValidationError("provide either order or cancelAll=true");
  }
  requireAuthenticatedMaker(req, parsed.data.order.maker);
  const tx = buildCancelOrderTx(toFxOrder(parsed.data.order));
  res.json({ success: true, kind: "cancelOrder", tx: { to: tx.to, data: tx.data, value: "0" } });
});
