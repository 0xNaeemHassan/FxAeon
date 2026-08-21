import { beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@fxaeon/db";

const sideEffects = vi.hoisted(() => ({
  broadcast: vi.fn(),
  waitForReceipt: vi.fn(),
}));

vi.mock("../src/core/broadcast.js", () => ({
  broadcastTransaction: (...args: unknown[]) => sideEffects.broadcast(...args),
}));
vi.mock("../src/core/txExecutor.js", () => ({
  waitForReceipt: (...args: unknown[]) => sideEffects.waitForReceipt(...args),
}));
import {
  bumpFee,
  bumpFees,
  buildCancelTx,
  planReplacement,
  feesFromPending,
  txFromPending,
  executeReplacement,
  type PendingTx,
} from "../src/core/txReplace.js";
import type { Eip1559Fees } from "../src/core/fees.js";

const GWEI = 1_000_000_000n;

const pending: PendingTx = {
  hash: "0xabc",
  nonce: 7,
  to: "0x1111111111111111111111111111111111111111",
  data: "0xdeadbeef",
  value: "0",
  gasLimit: "600000",
  maxFeePerGas: (30n * GWEI).toString(),
  maxPriorityFeePerGas: (2n * GWEI).toString(),
};

const WALLET = "0x2222222222222222222222222222222222222222" as const;

beforeEach(() => {
  sideEffects.broadcast.mockReset();
  sideEffects.waitForReceipt.mockReset();
});

describe("bumpFee", () => {
  it("raises by at least 12.5% (geth's 10% min replacement rule, with margin)", () => {
    const prev = 100n * GWEI;
    const next = bumpFee(prev);
    expect(next).toBeGreaterThanOrEqual((prev * 110n) / 100n); // > +10%
    expect(next).toBe((prev * 1125n + 999n) / 1000n); // exact ceil(+12.5%)
  });

  it("is strictly greater than prev even for tiny values (no +0 replacement)", () => {
    expect(bumpFee(0n)).toBe(1n);
    expect(bumpFee(1n)).toBeGreaterThan(1n);
    expect(bumpFee(7n)).toBeGreaterThan(7n);
  });

  it("re-floors to a fresh market fee when the base fee spiked", () => {
    const prev = 10n * GWEI;
    const freshFloor = 50n * GWEI; // market jumped well past +12.5%
    expect(bumpFee(prev, freshFloor)).toBe(freshFloor);
  });

  it("rejects negative input", () => {
    expect(() => bumpFee(-1n)).toThrow();
  });
});

describe("bumpFees", () => {
  it("bumps both fields and keeps maxFee >= priority", () => {
    const prev: Eip1559Fees = {
      maxFeePerGas: 30n * GWEI,
      maxPriorityFeePerGas: 2n * GWEI,
      nextBaseFee: 28n * GWEI,
    };
    const out = bumpFees(prev);
    expect(out.maxFeePerGas).toBeGreaterThan(prev.maxFeePerGas);
    expect(out.maxPriorityFeePerGas).toBeGreaterThan(prev.maxPriorityFeePerGas);
    expect(out.maxFeePerGas).toBeGreaterThanOrEqual(out.maxPriorityFeePerGas);
  });

  it("respects a fresh market floor on both fields", () => {
    const prev: Eip1559Fees = {
      maxFeePerGas: 10n * GWEI,
      maxPriorityFeePerGas: 1n * GWEI,
      nextBaseFee: 9n * GWEI,
    };
    const fresh: Eip1559Fees = {
      maxFeePerGas: 80n * GWEI,
      maxPriorityFeePerGas: 5n * GWEI,
      nextBaseFee: 75n * GWEI,
    };
    const out = bumpFees(prev, fresh);
    expect(out.maxFeePerGas).toBeGreaterThanOrEqual(fresh.maxFeePerGas);
    expect(out.maxPriorityFeePerGas).toBeGreaterThanOrEqual(fresh.maxPriorityFeePerGas);
  });

  it("fails closed when repeated bumps cross absolute priority or total-fee caps", () => {
    expect(() => bumpFees({
      maxFeePerGas: 100n * GWEI,
      maxPriorityFeePerGas: 19n * GWEI,
      nextBaseFee: 81n * GWEI,
    })).toThrow(/priority fee.*safety cap/i);
    expect(() => planReplacement({
      ...pending,
      gasLimit: "10000000",
      maxFeePerGas: (100n * GWEI).toString(),
    }, "speedup", WALLET)).toThrow(/worst-case network fee/i);
  });
});

describe("buildCancelTx", () => {
  it("is a 0-value self-send with empty calldata", () => {
    const tx = buildCancelTx(WALLET);
    expect(tx.to).toBe(WALLET);
    expect(tx.value).toBe(0n);
    expect(tx.data).toBe("0x");
  });
});

describe("planReplacement", () => {
  it("cancel: self-send to own wallet, same nonce, bumped fees, 21000 gas", () => {
    const plan = planReplacement(pending, "cancel", WALLET);
    expect(plan.kind).toBe("cancel");
    expect(plan.tx.to).toBe(WALLET);
    expect(plan.tx.value).toBe(0n);
    expect(plan.nonce).toBe(7);
    expect(plan.gasLimit).toBe(21_000n);
    expect(plan.fees.maxFeePerGas).toBeGreaterThan(BigInt(pending.maxFeePerGas));
    expect(plan.fees.maxPriorityFeePerGas).toBeGreaterThan(BigInt(pending.maxPriorityFeePerGas));
  });

  it("speed-up: same call (to/data/value), same nonce, same gas, bumped fees", () => {
    const plan = planReplacement(pending, "speedup", WALLET);
    expect(plan.kind).toBe("speedup");
    expect(plan.tx.to).toBe(pending.to);
    expect(plan.tx.data).toBe(pending.data);
    expect(plan.nonce).toBe(7);
    expect(plan.gasLimit).toBe(BigInt(pending.gasLimit));
    expect(plan.fees.maxFeePerGas).toBeGreaterThan(BigInt(pending.maxFeePerGas));
  });
});

describe("round-trips", () => {
  it("feesFromPending / txFromPending reconstruct the bigints", () => {
    expect(feesFromPending(pending).maxFeePerGas).toBe(BigInt(pending.maxFeePerGas));
    expect(txFromPending(pending).value).toBe(0n);
    expect(txFromPending(pending).to).toBe(pending.to);
  });
});

describe("executeReplacement authorization", () => {
  const params = {
    recordId: "record-1",
    userId: "user-1",
    walletId: "wallet-1",
    walletAddress: WALLET,
    client: {} as never,
    kind: "speedup" as const,
  };

  it("does not reveal or replace another user's record", async () => {
    (prisma as unknown as { txRecord: unknown }).txRecord = {
      findUnique: vi.fn(async () => ({
        id: "record-1",
        userId: "user-2",
        status: "broadcast",
        data: { chainId: 1, walletAddress: WALLET, pending },
      })),
    };

    await expect(executeReplacement(params)).resolves.toEqual({ ok: false, reason: "no such tx record" });
  });

  it("refuses a record created by a different or unscoped wallet", async () => {
    (prisma as unknown as { txRecord: unknown }).txRecord = {
      findUnique: vi.fn(async () => ({
        id: "record-1",
        userId: "user-1",
        status: "broadcast",
        data: {
          chainId: 1,
          walletAddress: "0x3333333333333333333333333333333333333333",
          pending,
        },
      })),
    };

    const result = await executeReplacement(params);
    expect(result).toEqual({ ok: false, reason: "tx record does not belong to the active wallet" });
  });

  it("rejects an opposite-kind race instead of coalescing cancel into speed-up", async () => {
    let release!: () => void;
    sideEffects.broadcast.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve("0x" + "a".repeat(64));
    }));
    sideEffects.waitForReceipt.mockResolvedValue("confirmed");
    const record = {
      id: "record-1",
      userId: "user-1",
      status: "broadcast",
      data: {
        chainId: 1,
        walletAddress: WALLET,
        hashes: [pending.hash],
        steps: [{ index: 0, status: "broadcast", hash: pending.hash }],
        pending: { ...pending, routeIndex: 0, routeLength: 1 },
      },
    };
    (prisma as unknown as { txRecord: unknown }).txRecord = {
      findUnique: vi.fn(async () => record),
      update: vi.fn(async () => ({})),
    };

    const speeding = executeReplacement(params);
    await vi.waitFor(() => expect(sideEffects.broadcast).toHaveBeenCalledTimes(1));
    const cancelling = await executeReplacement({ ...params, kind: "cancel" });
    expect(cancelling).toEqual({
      ok: false,
      reason: expect.stringMatching(/speedup replacement is already in progress/i),
    });
    release();
    await expect(speeding).resolves.toMatchObject({ ok: true, kind: "speedup" });
    expect(sideEffects.broadcast).toHaveBeenCalledTimes(1);
  });

  it("marks a mined cancellation as cancelled, never confirmed", async () => {
    sideEffects.broadcast.mockResolvedValue("0x" + "b".repeat(64));
    sideEffects.waitForReceipt.mockResolvedValue("confirmed");
    const update = vi.fn(async () => ({}));
    const record = {
      id: "record-1",
      userId: "user-1",
      status: "broadcast",
      data: {
        chainId: 1,
        walletAddress: WALLET,
        hashes: [pending.hash],
        steps: [{ index: 0, status: "broadcast", hash: pending.hash }],
        pending: { ...pending, routeIndex: 0, routeLength: 2 },
      },
    };
    (prisma as unknown as { txRecord: unknown }).txRecord = {
      findUnique: vi.fn(async () => record),
      update,
    };
    await expect(executeReplacement({ ...params, kind: "cancel" })).resolves.toMatchObject({
      ok: true,
      kind: "cancel",
    });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({ data: { status: "cancelled" } });
  });
});
