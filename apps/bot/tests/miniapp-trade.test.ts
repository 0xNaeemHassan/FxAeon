/**
 * In-app trade execution (Mini App screens 2/3/5) — the /trade/quote and
 * /trade/execute endpoints plus the core logic behind them.
 *
 * These mock the chain + execution deps so we can prove the SAFE wiring
 * without a live RPC/Privy/Postgres: real validation, fail-closed simulation,
 * the session-signer gate, idempotent execution, and honest error mapping.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { prisma } from "@fxbot/db";

const GWEI = 1_000_000_000n;

// -- mock the chain + execution deps (hoisted) -------------------------------
const quoteOpenPositionMock = vi.fn();
const simulateRouteMock = vi.fn();
const createFxSdkMock = vi.fn(() => ({}));
const publicClientMock = vi.fn(() => ({}) as unknown);
vi.mock("../src/fx/index", () => ({
  collateralDecimals: () => 18,
  createFxSdk: (...a: unknown[]) => createFxSdkMock(...a),
  createPublicClientForUser: (...a: unknown[]) => publicClientMock(...a),
  quoteOpenPosition: (...a: unknown[]) => quoteOpenPositionMock(...a),
  simulateRoute: (...a: unknown[]) => simulateRouteMock(...a),
}));

const getEip1559FeeTiersMock = vi.fn();
vi.mock("../src/core/fees", () => ({
  getEip1559FeeTiers: (...a: unknown[]) => getEip1559FeeTiersMock(...a),
  // real passthrough — the selector is trivial and worth exercising
  selectFeeTier: (tiers: Record<string, unknown>, key: string) => tiers[key],
}));

const executeRouteMock = vi.fn();
vi.mock("../src/core/txExecutor", () => ({
  executeRoute: (...a: unknown[]) => executeRouteMock(...a),
}));

const requireDelegatedWalletMock = vi.fn();
vi.mock("../src/core/delegation", () => ({
  requireDelegatedWallet: (...a: unknown[]) => requireDelegatedWalletMock(...a),
  BOT_TRADING_DISABLED_MESSAGE: "Bot trading is off.",
}));

vi.mock("../src/core/portfolio", () => ({ listUserPositions: vi.fn().mockResolvedValue([]) }));
vi.mock("../src/core/pnl", () => ({ trackPositions: vi.fn().mockResolvedValue(new Map()) }));

const getSpotPricesMock = vi.fn();
vi.mock("../src/market/coingecko", () => ({
  getSpotPrices: (...a: unknown[]) => getSpotPricesMock(...a),
  getMarketOverview: vi.fn(),
}));
vi.mock("../src/core/funding", () => ({
  getFundingState: vi.fn().mockResolvedValue({ known: false }),
  describeFunding: () => "",
}));

import {
  validateTradeBody,
  gasTierCost,
  buildGasEstimate,
  buildReceiptInfo,
  maxLeverageFor,
} from "../src/core/miniappTrade";

// Shared fee-tier fixture: market tier = 20 gwei maxFee so that 250k gas
// ⇒ 0.005 ETH ⇒ $17.5 at $3500/ETH (keeps the legacy gas assertions intact).
const FEE_TIERS = {
  nextBaseFee: 9n * GWEI,
  slow: { maxFeePerGas: 19n * GWEI, maxPriorityFeePerGas: 1n * GWEI, nextBaseFee: 9n * GWEI },
  market: { maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: 2n * GWEI, nextBaseFee: 9n * GWEI },
  fast: { maxFeePerGas: 22n * GWEI, maxPriorityFeePerGas: 4n * GWEI, nextBaseFee: 9n * GWEI },
};
import { createMiniAppRouter } from "../src/api/miniapp";

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------
describe("validateTradeBody", () => {
  it("accepts a well-formed long", () => {
    const r = validateTradeBody({ market: "wstETH", side: "long", leverage: 3, amount: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual({ market: "wstETH", side: "long", leverage: 3, amount: 1 });
  });

  it("coerces numeric strings from JSON bodies", () => {
    const r = validateTradeBody({ market: "WBTC", side: "short", leverage: "2", amount: "0.5" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.leverage).toBe(2);
  });

  it("rejects an unknown market", () => {
    const r = validateTradeBody({ market: "DOGE", side: "long", leverage: 3, amount: 1 });
    expect(r).toMatchObject({ ok: false, code: "BAD_MARKET" });
  });

  it("rejects a bad side", () => {
    const r = validateTradeBody({ market: "wstETH", side: "sideways", leverage: 3, amount: 1 });
    expect(r).toMatchObject({ ok: false, code: "BAD_SIDE" });
  });

  it("rejects leverage above the side cap", () => {
    const over = maxLeverageFor("long") + 1;
    const r = validateTradeBody({ market: "wstETH", side: "long", leverage: over, amount: 1 });
    expect(r).toMatchObject({ ok: false, code: "BAD_LEVERAGE" });
  });

  it("rejects a non-positive amount", () => {
    const r = validateTradeBody({ market: "wstETH", side: "long", leverage: 3, amount: 0 });
    expect(r).toMatchObject({ ok: false, code: "BAD_AMOUNT" });
  });
});

describe("gasTierCost", () => {
  it("computes wei/eth/usd from real units + fees", () => {
    const g = gasTierCost(250_000n, { maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: 1n * GWEI, nextBaseFee: 9n * GWEI }, "market", 3500);
    expect(g.key).toBe("market");
    expect(g.maxFeeGwei).toBe(20);
    expect(g.priorityGwei).toBe(1);
    expect(g.estCostWei).toBe("5000000000000000"); // 0.005 ETH
    expect(g.estCostEth).toBeCloseTo(0.005, 12);
    expect(g.estCostUsd).toBeCloseTo(17.5, 9);
  });

  it("leaves USD null when no ETH price is known (no fabrication)", () => {
    const g = gasTierCost(250_000n, { maxFeePerGas: 20n * GWEI, maxPriorityFeePerGas: 1n * GWEI, nextBaseFee: 9n * GWEI }, "slow", null);
    expect(g.estCostUsd).toBeNull();
    expect(g.estCostEth).toBeCloseTo(0.005, 12);
  });
});

describe("buildGasEstimate", () => {
  it("emits exactly [slow, market, fast], monotonic cost, market default", () => {
    const est = buildGasEstimate(250_000n, FEE_TIERS, 3500);
    expect(est.units).toBe("250000");
    expect(est.recommended).toBe("market");
    expect(est.tiers.map((t) => t.key)).toEqual(["slow", "market", "fast"]);
    expect(est.tiers[0].estCostEth).toBeLessThanOrEqual(est.tiers[1].estCostEth);
    expect(est.tiers[1].estCostEth).toBeLessThanOrEqual(est.tiers[2].estCostEth);
  });
});

describe("buildReceiptInfo", () => {
  it("derives block #, gas paid and confirmations from a real receipt", () => {
    const info = buildReceiptInfo(
      { blockNumber: 1000n, gasUsed: 120_000n, effectiveGasPrice: 18n * GWEI },
      1002n,
      3500
    );
    expect(info.blockNumber).toBe(1000);
    expect(info.gasUsed).toBe("120000");
    expect(info.effectiveGasPriceGwei).toBe(18);
    expect(info.gasPaidWei).toBe("2160000000000000"); // 120000 * 18 gwei
    expect(info.gasPaidEth).toBeCloseTo(0.00216, 12);
    expect(info.gasPaidUsd).toBeCloseTo(7.56, 9);
    expect(info.confirmations).toBe(3); // 1002 - 1000 + 1
  });

  it("floors confirmations at 1 and leaves USD null without a price", () => {
    const info = buildReceiptInfo(
      { blockNumber: 1000n, gasUsed: 100_000n, effectiveGasPrice: 10n * GWEI },
      999n,
      null
    );
    expect(info.confirmations).toBe(1);
    expect(info.gasPaidUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
const BOT_TOKEN = "12345:TEST-TOKEN";
const TG_USER = { id: 777000111, first_name: "Naeem", username: "tester" };

function makeInitData(user: Record<string, unknown>, token = BOT_TOKEN): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "AAE-test");
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const ROUTE = {
  routeType: "leverageUp",
  leverage: 3,
  executionPrice: "3500.0",
  colls: "1000000000000000000",
  debts: "0",
  txs: [
    { to: "0x33636D49FbefBE798e15e7F356E8DBef543CC708", data: "0xaaaa", value: 0n },
    { to: "0x33636D49FbefBE798e15e7F356E8DBef543CC708", data: "0xbbbb", value: 0n },
  ],
};

const DB_USER = {
  id: "u1",
  telegramId: "777000111",
  privyUserId: "privy-1",
  walletAddress: "0xAbCd000000000000000000000000000000001234",
  privyWalletId: "w1",
  walletDelegated: true,
  walletImported: false,
  slippageBps: 50,
  mevProtection: "off",
};

describe("router /trade/quote + /trade/execute", () => {
  let server: Server;
  let base: string;
  const auth = { Authorization: `tma ${makeInitData(TG_USER)}`, "Content-Type": "application/json" };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api/v1/miniapp",
      createMiniAppRouter({ botToken: BOT_TOKEN, sendMessage: vi.fn(), miniAppUrl: "https://example.test" })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/v1/miniapp`;
  });
  afterAll(() => server?.close());

  beforeEach(() => {
    vi.clearAllMocks();
    createFxSdkMock.mockReturnValue({});
    quoteOpenPositionMock.mockResolvedValue({ positionId: 0, slippage: 0.5, routes: [ROUTE] });
    simulateRouteMock.mockResolvedValue({ success: true, gasUsed: [100_000n, 150_000n], totalGas: 250_000n });
    getEip1559FeeTiersMock.mockResolvedValue(FEE_TIERS);
    getSpotPricesMock.mockResolvedValue({ stale: false, prices: { ETH: 3500 } });
    publicClientMock.mockReturnValue({});
    requireDelegatedWalletMock.mockResolvedValue({ ok: true, walletId: "w1" });
    executeRouteMock.mockResolvedValue({ ok: true, deduped: false, recordId: "r1", status: "confirmed", hashes: ["0xfeed"] });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(DB_USER as never);
  });

  // -- auth + validation --
  it("401s without auth", async () => {
    const r = await fetch(`${base}/trade/quote`, { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
  });

  it("400s on an invalid market", async () => {
    const r = await fetch(`${base}/trade/quote`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "DOGE", side: "long", leverage: 3, amount: 1 }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("BAD_MARKET");
  });

  it("404s when the user is not onboarded", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const r = await fetch(`${base}/trade/quote`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1 }),
    });
    expect(r.status).toBe(404);
  });

  // -- /trade/quote --
  it("returns a real quote with simulated gas (no fabrication)", async () => {
    const r = await fetch(`${base}/trade/quote`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1 }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.quote.executionPrice).toBe("3500.0");
    expect(body.quote.exposure).toBe(3);
    expect(body.quote.collateralAfter).toBeCloseTo(1, 9); // colls 1e18 @ 18 dp
    expect(body.quote.debtAfter).toBe(0);
    // Real Slow/Market/Fast tiers, market is the default.
    expect(body.quote.gas.units).toBe("250000");
    expect(body.quote.gas.recommended).toBe("market");
    expect(body.quote.gas.tiers.map((t: { key: string }) => t.key)).toEqual(["slow", "market", "fast"]);
    const market = body.quote.gas.tiers.find((t: { key: string }) => t.key === "market");
    expect(market.estCostEth).toBeCloseTo(0.005, 9);
    expect(market.estCostUsd).toBeCloseTo(17.5, 6);
  });

  it("422s with SIMULATION_FAILED when the route would revert (fail-closed)", async () => {
    simulateRouteMock.mockResolvedValueOnce({ success: false, error: "execution reverted", failedTxIndex: 1 });
    const r = await fetch(`${base}/trade/quote`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1 }),
    });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("SIMULATION_FAILED");
    expect(executeRouteMock).not.toHaveBeenCalled();
  });

  it("422s with NO_ROUTE when the SDK builds no route", async () => {
    quoteOpenPositionMock.mockResolvedValueOnce({ positionId: 0, slippage: 0.5, routes: [] });
    const r = await fetch(`${base}/trade/quote`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1 }),
    });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("NO_ROUTE");
  });

  // -- /trade/execute --
  it("executes via executeRoute and returns the tx hash", async () => {
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-abc-123" }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.txHash).toBe("0xfeed");
    expect(body.status).toBe("confirmed");
    // Server-side re-quote: client never supplies calldata.
    expect(quoteOpenPositionMock).toHaveBeenCalledTimes(1);
    // Idempotency key carries the user id + nonce.
    expect(executeRouteMock.mock.calls[0][0].idempotencyKey).toBe("miniapp-trade:u1:nonce-abc-123");
    expect(executeRouteMock.mock.calls[0][0].type).toBe("open_long");
  });

  it("broadcasts with the server-derived FAST tier when the user picks fast", async () => {
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-fast-1", feeTier: "fast" }),
    });
    expect(r.status).toBe(200);
    // The fee numbers come from the server's re-derived tiers, not the client.
    expect(executeRouteMock.mock.calls[0][0].fees).toEqual(FEE_TIERS.fast);
  });

  it("defaults to the MARKET tier when feeTier is absent or junk", async () => {
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-def-1", feeTier: "ludicrous" }),
    });
    expect(r.status).toBe(200);
    expect(executeRouteMock.mock.calls[0][0].fees).toEqual(FEE_TIERS.market);
  });

  it("returns real receipt detail (block #, gas paid, confirmations) on the result", async () => {
    publicClientMock.mockReturnValue({
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 21_000_000n,
        gasUsed: 180_000n,
        effectiveGasPrice: 15n * GWEI,
      }),
      getBlockNumber: vi.fn().mockResolvedValue(21_000_004n),
    });
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-rcpt-1" }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.receipt.blockNumber).toBe(21_000_000);
    expect(body.receipt.gasUsed).toBe("180000");
    expect(body.receipt.confirmations).toBe(5); // 21000004 - 21000000 + 1
    expect(body.receipt.gasPaidEth).toBeCloseTo(0.0027, 9); // 180000 * 15 gwei
  });

  it("keeps receipt null (fail-soft) when the receipt can't be read", async () => {
    publicClientMock.mockReturnValue({}); // no receipt methods
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-rcpt-2" }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).receipt).toBeNull();
  });

  it("400s on a missing/malformed nonce", async () => {
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1 }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("BAD_NONCE");
    expect(executeRouteMock).not.toHaveBeenCalled();
  });

  it("409s with BOT_TRADING_OFF when the session-signer grant is missing", async () => {
    requireDelegatedWalletMock.mockResolvedValueOnce({ ok: false, message: "Bot trading is off." });
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-abc-123" }),
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("BOT_TRADING_OFF");
    // Gate fails closed BEFORE any quote/broadcast.
    expect(quoteOpenPositionMock).not.toHaveBeenCalled();
    expect(executeRouteMock).not.toHaveBeenCalled();
  });

  it("422s when executeRoute reports a failure (e.g. simulation revert)", async () => {
    executeRouteMock.mockResolvedValueOnce({
      ok: false, deduped: false, recordId: "r1", status: "failed", error: "simulation failed at tx 1: reverted",
    });
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-abc-123" }),
    });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("EXECUTION_FAILED");
  });

  it("surfaces an idempotent dedupe instead of double-broadcasting", async () => {
    executeRouteMock.mockResolvedValueOnce({ ok: true, deduped: true, recordId: "r1", status: "confirmed", hashes: ["0xfeed"] });
    const r = await fetch(`${base}/trade/execute`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ market: "wstETH", side: "long", leverage: 3, amount: 1, nonce: "nonce-abc-123" }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).deduped).toBe(true);
  });
});
