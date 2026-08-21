import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@fxaeon/db";

const createFxSdkMock = vi.fn();
const quoteOpenPositionMock = vi.fn();
const simulateRouteMock = vi.fn();
const publicClientMock = vi.fn();

vi.mock("../src/fx/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createFxSdk: (...args: unknown[]) => createFxSdkMock(...args),
  quoteOpenPosition: (...args: unknown[]) => quoteOpenPositionMock(...args),
  simulateRoute: (...args: unknown[]) => simulateRouteMock(...args),
  createPublicClientForUser: (...args: unknown[]) => publicClientMock(...args),
}));

import { simulateRouter } from "../src/api/simulate-trade.js";
import { __resetConfigForTests } from "../src/middleware/config.js";

const BOT_TOKEN = "12345:SIMULATE-TEST";
const TELEGRAM_ID = "777000111";
const WALLET = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const OTHER_WALLET = "0x1111111111111111111111111111111111111111";

function initData(): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify({ id: Number(TELEGRAM_ID), first_name: "Test" }));
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "simulate-test");
  const data = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
  return params.toString();
}

describe("legacy simulation API auth boundary", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.DATABASE_URL = "postgresql://localhost/test";
    __resetConfigForTests();
    const app = express();
    app.use(express.json());
    app.use("/api/simulate", simulateRouter);
    app.use((err: { status?: number; code?: string; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.status ?? 500).json({ error: { code: err.code ?? "INTERNAL", message: err.message } });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/simulate`;
  });

  afterAll(() => server?.close());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1", walletAddress: WALLET } as never);
    createFxSdkMock.mockReturnValue({});
    quoteOpenPositionMock.mockResolvedValue({
      routes: [{ routeType: "fx", executionPrice: "1", colls: "1", debts: "0", txs: [] }],
      slippage: 0.5,
    });
    simulateRouteMock.mockResolvedValue({ success: true, gasUsed: [], totalGas: 0n });
    publicClientMock.mockReturnValue({
      getGasPrice: vi.fn().mockResolvedValue(1n),
      getFeeHistory: vi.fn().mockResolvedValue({ baseFeePerGas: [1n] }),
    });
  });

  const body = (address = WALLET, amountWei = "1") => ({
    address,
    market: "wstETH",
    side: "long",
    leverage: 2,
    amountWei,
  });

  it("rejects anonymous callers before database, SDK, or RPC work", async () => {
    const response = await fetch(`${base}/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(response.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(createFxSdkMock).not.toHaveBeenCalled();
  });

  it("binds simulation to the authenticated user's wallet", async () => {
    const response = await fetch(`${base}/trade`, {
      method: "POST",
      headers: { Authorization: `tma ${initData()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body(OTHER_WALLET)),
    });
    expect(response.status).toBe(400);
    expect(createFxSdkMock).not.toHaveBeenCalled();
  });

  it.each(["0", "01", (1n << 256n).toString()])("rejects non-canonical or out-of-range wei %s", async (amountWei) => {
    const response = await fetch(`${base}/trade`, {
      method: "POST",
      headers: { Authorization: `tma ${initData()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body(WALLET, amountWei)),
    });
    expect(response.status).toBe(400);
    expect(createFxSdkMock).not.toHaveBeenCalled();
  });

  it("quotes and simulates only after authentication and wallet binding", async () => {
    const response = await fetch(`${base}/trade`, {
      method: "POST",
      headers: { Authorization: `tma ${initData()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(response.status).toBe(200);
    expect(quoteOpenPositionMock).toHaveBeenCalledWith(expect.objectContaining({
      userAddress: WALLET,
      amountWei: 1n,
    }));
  });
});
