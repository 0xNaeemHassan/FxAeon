import { describe, expect, it, vi } from "vitest";
import {
  buildGasEstimate,
  buildReceiptInfo,
  gasTierCost,
  readTradeReceipt,
  routeGasLimitWithHeadroom,
} from "../src/core/actionPresentation.js";

const GWEI = 1_000_000_000n;
const fee = (max: bigint, tip: bigint) => ({
  maxFeePerGas: max * GWEI,
  maxPriorityFeePerGas: tip * GWEI,
  nextBaseFee: 9n * GWEI,
});

describe("action presentation", () => {
  it("derives gas cost from chain units without inventing USD", () => {
    const priced = gasTierCost(250_000n, fee(20n, 1n), "market", 3_500);
    expect(priced.estCostWei).toBe("5000000000000000");
    expect(priced.estCostEth).toBe(0.005);
    expect(priced.estCostUsd).toBe(17.5);
    expect(gasTierCost(250_000n, fee(20n, 1n), "slow", null).estCostUsd).toBeNull();
  });

  it("builds ordered slow, market and fast tiers", () => {
    const estimate = buildGasEstimate(250_000n, {
      slow: fee(15n, 1n),
      market: fee(20n, 2n),
      fast: fee(30n, 3n),
    }, 3_500);
    expect(estimate.units).toBe("250000");
    expect(estimate.tiers.map((tier) => tier.key)).toEqual(["slow", "market", "fast"]);
    expect(estimate.recommended).toBe("market");
  });

  it("matches the executor's 20% headroom independently for every route step", () => {
    expect(routeGasLimitWithHeadroom([50_000n, 400_001n])).toBe(540_001n);
  });

  it("derives receipt cost and confirmations from actual block data", () => {
    const receipt = buildReceiptInfo(
      { blockNumber: 100n, gasUsed: 21_000n, effectiveGasPrice: 20n * GWEI },
      104n,
      3_000
    );
    expect(receipt.confirmations).toBe(5);
    expect(receipt.gasPaidWei).toBe("420000000000000");
    expect(receipt.gasPaidUsd).toBeCloseTo(1.26);
  });

  it("reads receipts fail-soft", async () => {
    const client = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 10n,
        gasUsed: 21_000n,
        effectiveGasPrice: GWEI,
      }),
      getBlockNumber: vi.fn().mockResolvedValue(12n),
    };
    expect(await readTradeReceipt(client, `0x${"1".repeat(64)}`, null)).toMatchObject({
      blockNumber: 10,
      confirmations: 3,
    });
    client.getTransactionReceipt.mockRejectedValueOnce(new Error("rpc down"));
    expect(await readTradeReceipt(client, `0x${"2".repeat(64)}`, null)).toBeNull();
  });
});
