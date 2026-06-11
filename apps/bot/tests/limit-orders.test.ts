/**
 * Limit order EIP-712 tests.
 *
 * The fixture digest below is GROUND TRUTH: it was produced by calling the live
 * LimitOrderManager's getOrderHash() (0x112873b395B98287F3A4db266a58e2D01779Ad96,
 * Ethereum mainnet, read-only) with exactly this order on 2026-06-11. Local hashing
 * must reproduce it bit-for-bit; if any of these tests fail, signing is unsound and
 * MUST stay disabled.
 */
import { describe, it, expect } from "vitest";
import { keccak256, toHex, toFunctionSelector, decodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES } from "@fxbot/shared";
import {
  type FxLimitOrder,
  LIMIT_ORDER_DOMAIN,
  LIMIT_ORDER_MANAGER,
  LIMIT_ORDER_MANAGER_ABI,
  LIMIT_ORDER_TYPEHASH,
  ORDER_TYPES,
  buildCancelOrderTx,
  buildIncreaseNonceTx,
  buildSignPayload,
  hashOrder,
  randomSalt,
  toWireOrder,
  validateOrderDeltas,
  verifyOrderSignature,
} from "../src/fx/limitOrders.js";

/** Exact type string from OrderLibrary.sol (fx-protocol-contracts @ 5e198e93). */
const CONTRACT_TYPE_STRING =
  "Order(address maker,address pool,uint256 positionId,bool positionSide,bool orderType,bool orderSide,bool allowPartialFill,uint256 triggerPrice,int256 fxUSDDelta,int256 collDelta,int256 debtDelta,uint256 nonce,bytes32 salt,uint256 deadline)";

/** Fixture order — the exact struct sent to the live contract's getOrderHash(). */
const FIXTURE_ORDER: FxLimitOrder = {
  maker: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  pool: "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8", // WSTETH_LONG_POOL
  positionId: 1n,
  positionSide: true,
  orderType: false,
  orderSide: true,
  allowPartialFill: true,
  triggerPrice: 2800000000000000000000n,
  fxUSDDelta: 1000000000000000000000n,
  collDelta: 500000000000000000n,
  debtDelta: 0n,
  nonce: 0n,
  salt: "0x1234567890123456789012345678901234567890123456789012345678901234",
  deadline: 1893456000n, // 2030-01-01, keeps the fixture stable
};

/** Returned by the live contract for FIXTURE_ORDER (mainnet, 2026-06-11). */
const ONCHAIN_FIXTURE_HASH = "0x76b7cbaf50964c646cae7ace4a02a98a67ea83641555e87fd397c6eb1a2c5224";

describe("Limit order EIP-712 — domain & typehash", () => {
  it("domain matches LimitOrderManager.__EIP712_init and the live eip712Domain()", () => {
    expect(LIMIT_ORDER_DOMAIN.name).toBe("f(x) Limit Order Manager");
    expect(LIMIT_ORDER_DOMAIN.version).toBe("1");
    expect(LIMIT_ORDER_DOMAIN.chainId).toBe(1);
    expect(LIMIT_ORDER_DOMAIN.verifyingContract).toBe("0x112873b395B98287F3A4db266a58e2D01779Ad96");
    expect(LIMIT_ORDER_MANAGER).toBe(ADDRESSES.LIMIT_ORDER_MANAGER);
  });

  it("our Order type encodes to the exact contract type string", () => {
    const encoded = `Order(${ORDER_TYPES.Order.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(encoded).toBe(CONTRACT_TYPE_STRING);
  });

  it("keccak256 of the type string equals OrderLibrary.LIMIT_ORDER_TYPEHASH", () => {
    expect(keccak256(toHex(CONTRACT_TYPE_STRING))).toBe(LIMIT_ORDER_TYPEHASH);
  });
});

describe("Limit order EIP-712 — digest fixture (live-contract ground truth)", () => {
  it("hashOrder reproduces the live contract's getOrderHash for the fixture order", () => {
    expect(hashOrder(FIXTURE_ORDER)).toBe(ONCHAIN_FIXTURE_HASH);
  });

  it("digest changes when any field changes", () => {
    const mutations: Array<Partial<FxLimitOrder>> = [
      { positionId: 2n },
      { positionSide: false },
      { orderType: true },
      { orderSide: false },
      { allowPartialFill: false },
      { triggerPrice: FIXTURE_ORDER.triggerPrice + 1n },
      { fxUSDDelta: FIXTURE_ORDER.fxUSDDelta - 1n },
      { collDelta: 0n },
      { nonce: 1n },
      { salt: randomSalt() },
      { deadline: FIXTURE_ORDER.deadline + 1n },
    ];
    for (const mutation of mutations) {
      expect(hashOrder({ ...FIXTURE_ORDER, ...mutation })).not.toBe(ONCHAIN_FIXTURE_HASH);
    }
  });
});

describe("Limit order signing & recovery", () => {
  // Throwaway well-known anvil key — never used on mainnet.
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  );

  it("signTypedData payload signature recovers to the maker", async () => {
    const order: FxLimitOrder = { ...FIXTURE_ORDER, maker: account.address };
    const payload = buildSignPayload(order);
    const signature = await account.signTypedData(payload);
    expect(await verifyOrderSignature(order, signature)).toBe(true);
  });

  it("rejects a signature from a different maker", async () => {
    const order: FxLimitOrder = { ...FIXTURE_ORDER, maker: account.address };
    const signature = await account.signTypedData(buildSignPayload(order));
    const forged: FxLimitOrder = { ...order, maker: FIXTURE_ORDER.maker };
    expect(await verifyOrderSignature(forged, signature)).toBe(false);
  });
});

describe("Order validation — mirrors OrderLibrary.validateOrder", () => {
  const future = BigInt(Math.floor(Date.now() / 1000) + 3600);

  it("stop orders must have non-positive deltas and a trigger price", () => {
    const stop: FxLimitOrder = {
      ...FIXTURE_ORDER,
      orderType: true,
      fxUSDDelta: -1n,
      collDelta: -1n,
      debtDelta: 0n,
      deadline: future,
    };
    expect(() => validateOrderDeltas(stop)).not.toThrow();
    expect(() => validateOrderDeltas({ ...stop, collDelta: 1n })).toThrow(/collDelta/);
    expect(() => validateOrderDeltas({ ...stop, triggerPrice: 0n })).toThrow(/triggerPrice/i);
  });

  it("limit open orders must have non-negative deltas", () => {
    const open: FxLimitOrder = { ...FIXTURE_ORDER, deadline: future };
    expect(() => validateOrderDeltas(open)).not.toThrow();
    expect(() => validateOrderDeltas({ ...open, fxUSDDelta: -1n })).toThrow(/fxUSDDelta/);
  });

  it("limit close orders must have non-positive deltas", () => {
    const close: FxLimitOrder = {
      ...FIXTURE_ORDER,
      orderSide: false,
      fxUSDDelta: -1n,
      collDelta: 0n,
      debtDelta: -5n,
      deadline: future,
    };
    expect(() => validateOrderDeltas(close)).not.toThrow();
    expect(() => validateOrderDeltas({ ...close, debtDelta: 5n })).toThrow(/debtDelta/);
  });

  it("rejects orders whose deadline already passed", () => {
    expect(() => validateOrderDeltas({ ...FIXTURE_ORDER, deadline: 1n })).toThrow(/deadline/);
  });
});

describe("Cancellation calldata", () => {
  it("cancelOrder targets the manager with the right selector and round-trips the order", () => {
    const tx = buildCancelOrderTx(FIXTURE_ORDER);
    expect(tx.to).toBe(LIMIT_ORDER_MANAGER);
    expect(tx.value).toBe(0n);
    expect(tx.data.slice(0, 10)).toBe(
      toFunctionSelector(
        "function cancelOrder((address,address,uint256,bool,bool,bool,bool,uint256,int256,int256,int256,uint256,bytes32,uint256))"
      )
    );
    const decoded = decodeFunctionData({ abi: LIMIT_ORDER_MANAGER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("cancelOrder");
    const order = decoded.args[0] as FxLimitOrder;
    expect(order.maker.toLowerCase()).toBe(FIXTURE_ORDER.maker.toLowerCase());
    expect(order.triggerPrice).toBe(FIXTURE_ORDER.triggerPrice);
    expect(order.salt).toBe(FIXTURE_ORDER.salt);
  });

  it("increaseNonce (cancel-all) encodes the bare selector", () => {
    const tx = buildIncreaseNonceTx();
    expect(tx.to).toBe(LIMIT_ORDER_MANAGER);
    expect(tx.data).toBe(toFunctionSelector("function increaseNonce()"));
  });
});

describe("Wire serialization", () => {
  it("toWireOrder emits the relay API shape (bigints as strings)", () => {
    const wire = toWireOrder(FIXTURE_ORDER);
    expect(wire).toEqual({
      maker: FIXTURE_ORDER.maker,
      pool: FIXTURE_ORDER.pool,
      positionId: 1,
      positionSide: true,
      orderType: false,
      orderSide: true,
      allowPartialFill: true,
      triggerPrice: "2800000000000000000000",
      fxUSDDelta: "1000000000000000000000",
      collDelta: "500000000000000000",
      debtDelta: "0",
      nonce: 0,
      salt: FIXTURE_ORDER.salt,
      deadline: 1893456000,
    });
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
  });

  it("randomSalt produces unique 32-byte hex values", () => {
    const a = randomSalt();
    const b = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});
