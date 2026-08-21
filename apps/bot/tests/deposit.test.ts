import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";

const dbMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@fxaeon/db", () => ({
  prisma: {
    depositWatcher: dbMocks,
  },
}));

vi.mock("../src/middleware/logger", () => ({
  botLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@fxaeon/shared", () => ({
  ADDRESSES: {
    FXUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    WSTETH: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
}));

import {
  activateDepositWatcher,
  getDepositRpcUrl,
  getDepositWatcherStats,
  pollDepositWatchersOnce,
} from "../src/notifications/deposit-watcher-poller.js";
import { __resetMetrics, snapshot } from "../src/core/metrics.js";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

function storedWatcher(overrides: Record<string, unknown> = {}) {
  return {
    id: "watcher-1",
    userId: "user-1",
    fromBlock: 100n,
    lastCheckedBlock: 100n,
    ethBalanceBaselineWei: 500n,
    user: {
      walletAddress: WALLET,
      telegramId: "123",
    },
    ...overrides,
  };
}

function fakeClient(options: {
  block?: bigint;
  balance?: bigint;
  logs?: unknown[];
} = {}): PublicClient {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(options.block ?? 105n),
    getBalance: vi.fn().mockResolvedValue(options.balance ?? 500n),
    getLogs: vi.fn().mockResolvedValue(options.logs ?? []),
  } as unknown as PublicClient;
}

beforeEach(() => {
  __resetMetrics();
  dbMocks.findMany.mockReset().mockResolvedValue([]);
  dbMocks.update.mockReset().mockResolvedValue({});
  dbMocks.create.mockReset().mockResolvedValue({ id: "watcher-new" });
});

describe("deposit watcher configuration", () => {
  it("starts with an idle stats snapshot", () => {
    expect(getDepositWatcherStats()).toEqual({
      pollCount: 0,
      running: false,
      lastBlockChecked: "0",
    });
  });

  it("uses only the canonical ALCHEMY_RPC_URL", () => {
    expect(
      getDepositRpcUrl({ ALCHEMY_RPC_URL: "https://rpc.example" })
    ).toBe("https://rpc.example");
    expect(() =>
      getDepositRpcUrl({ ETH_RPC_URL: "https://legacy.example" })
    ).toThrow("ALCHEMY_RPC_URL");
  });
});

describe("deposit watcher activation", () => {
  it("persists the activation block, scan cursor, and ETH baseline together", async () => {
    const client = fakeClient({ block: 12_345n, balance: 77n });

    await activateDepositWatcher("user-1", WALLET, client);

    expect(dbMocks.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        fromBlock: 12_345n,
        lastCheckedBlock: 12_345n,
        ethBalanceBaselineWei: 77n,
        expiresAt: expect.any(Date),
      },
    });
    expect(client.getBalance).toHaveBeenCalledWith({
      address: WALLET,
      blockNumber: 12_345n,
    });
  });
});

describe("deposit watcher polling", () => {
  it("emits a worker heartbeat even when there are no active watchers", async () => {
    await pollDepositWatchersOnce(fakeClient(), vi.fn().mockResolvedValue(undefined));

    expect(snapshot(["deposit-watcher-poller"]).workers["deposit-watcher-poller"])
      .toBeLessThanOrEqual(1);
  });

  it("honors each watcher's activation block when matching token logs", async () => {
    dbMocks.findMany.mockResolvedValue([
      storedWatcher({ fromBlock: 100n, lastCheckedBlock: 50n }),
    ]);
    const client = fakeClient({
      block: 105n,
      balance: 500n,
      logs: [
        {
          args: { from: "0x0000000000000000000000000000000000000001", to: WALLET, value: 1n },
          blockNumber: 99n,
          transactionHash: "0xold",
        },
        {
          args: { from: "0x0000000000000000000000000000000000000001", to: WALLET, value: 1n },
          blockNumber: 100n,
          transactionHash: "0xnew",
        },
      ],
    });
    const sendDm = vi.fn().mockResolvedValue(undefined);

    await pollDepositWatchersOnce(client, sendDm);

    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 51n, toBlock: 105n })
    );
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm.mock.calls[0]?.[1]).toContain("0xnew");
    expect(sendDm.mock.calls[0]?.[1]).not.toContain("0xold");
    expect(dbMocks.update).toHaveBeenCalledWith({
      where: { id: "watcher-1" },
      data: { firedAt: expect.any(Date) },
    });
  });

  it("detects native ETH only when balance rises above the persisted baseline", async () => {
    dbMocks.findMany.mockResolvedValue([storedWatcher()]);
    const client = fakeClient({ block: 101n, balance: 550n });
    const sendDm = vi.fn().mockResolvedValue(undefined);

    await pollDepositWatchersOnce(client, sendDm);

    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(sendDm.mock.calls[0]?.[1]).toContain("ETH received");
  });

  it("ignores zero-value and self-transfer token events", async () => {
    dbMocks.findMany.mockResolvedValue([storedWatcher()]);
    const client = fakeClient({
      block: 101n,
      balance: 500n,
      logs: [
        {
          args: {
            from: "0x0000000000000000000000000000000000000001",
            to: WALLET,
            value: 0n,
          },
          blockNumber: 101n,
          transactionHash: "0xzero",
        },
        {
          args: { from: WALLET, to: WALLET, value: 1n },
          blockNumber: 101n,
          transactionHash: "0xself",
        },
      ],
    });
    const sendDm = vi.fn().mockResolvedValue(undefined);

    await pollDepositWatchersOnce(client, sendDm);

    expect(sendDm).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith({
      where: { id: "watcher-1" },
      data: {
        lastCheckedBlock: 101n,
        ethBalanceBaselineWei: 500n,
      },
    });
  });

  it("bootstraps a legacy watcher without firing on its existing ETH", async () => {
    dbMocks.findMany.mockResolvedValue([
      storedWatcher({
        fromBlock: 0n,
        lastCheckedBlock: null,
        ethBalanceBaselineWei: null,
      }),
    ]);
    const client = fakeClient({ block: 200n, balance: 999n });
    const sendDm = vi.fn().mockResolvedValue(undefined);

    await pollDepositWatchersOnce(client, sendDm);

    expect(sendDm).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith({
      where: { id: "watcher-1" },
      data: {
        fromBlock: 200n,
        lastCheckedBlock: 200n,
        ethBalanceBaselineWei: 999n,
      },
    });
  });

  it("moves the ETH baseline down after a withdrawal so a later deposit is visible", async () => {
    dbMocks.findMany.mockResolvedValue([storedWatcher()]);
    const client = fakeClient({ block: 101n, balance: 400n });
    const sendDm = vi.fn().mockResolvedValue(undefined);

    await pollDepositWatchersOnce(client, sendDm);

    expect(sendDm).not.toHaveBeenCalled();
    expect(dbMocks.update).toHaveBeenCalledWith({
      where: { id: "watcher-1" },
      data: {
        lastCheckedBlock: 101n,
        ethBalanceBaselineWei: 400n,
      },
    });
  });

  it("does not advance a cursor when any token log query fails", async () => {
    dbMocks.findMany.mockResolvedValue([storedWatcher()]);
    const client = fakeClient({ block: 105n, balance: 500n });
    vi.mocked(client.getLogs).mockRejectedValueOnce(new Error("RPC timeout"));

    await expect(
      pollDepositWatchersOnce(client, vi.fn().mockResolvedValue(undefined))
    ).rejects.toThrow("RPC timeout");
    expect(dbMocks.update).not.toHaveBeenCalled();
  });

  it("retains the cursor when Telegram delivery fails so the event can retry", async () => {
    dbMocks.findMany.mockResolvedValue([storedWatcher()]);
    const client = fakeClient({
      block: 101n,
      balance: 500n,
      logs: [
        {
          args: { from: "0x0000000000000000000000000000000000000001", to: WALLET, value: 1n },
          blockNumber: 101n,
          transactionHash: "0xretry",
        },
      ],
    });
    const sendDm = vi.fn().mockRejectedValue(new Error("Telegram unavailable"));

    await pollDepositWatchersOnce(client, sendDm);

    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(dbMocks.update).not.toHaveBeenCalled();
  });
});
