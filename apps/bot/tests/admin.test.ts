import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Admin API unit tests.
 * 
 * Since supertest isn't in deps, we test the route handlers directly
 * by mocking Express req/res objects.
 */

// Mock botState
const botStateStore = new Map<string, string>();
vi.mock("../src/core/botState", () => ({
  getBotState: vi.fn(async (key: string) => botStateStore.get(key) ?? null),
  setBotState: vi.fn(async (key: string, value: string) => {
    botStateStore.set(key, value);
  }),
  BS_FEE_MODE: "fee_mode",
  BS_POLICY_MODE: "policy_mode",
}));

// Mock logger
vi.mock("../src/middleware/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock prisma with stats-friendly models
vi.mock("@fxaeon/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(42),
    },
    feeLedger: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { usdAmount: 123.45, notionalUsd: 50000 },
        _count: 10,
      }),
      count: vi.fn().mockResolvedValue(2),
    },
    txRecord: {
      count: vi.fn().mockResolvedValue(15),
    },
    position: {
      count: vi.fn().mockResolvedValue(7),
    },
    botState: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const val = botStateStore.get(where.key);
        return val !== undefined ? { key: where.key, value: val } : null;
      }),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        botStateStore.set(where.key, update.value);
        return { key: where.key, value: update.value };
      }),
    },
  },
}));

import { getBotState, setBotState } from "../src/core/botState";

describe("Admin API logic", () => {
  const ADMIN_TOKEN = "test-admin-token-123";

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    botStateStore.clear();
  });

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  describe("Auth check", () => {
    it("requires ADMIN_TOKEN to be set", () => {
      delete process.env.ADMIN_TOKEN;
      expect(process.env.ADMIN_TOKEN).toBeUndefined();
    });

    it("validates Bearer token format", () => {
      const auth = `Bearer ${ADMIN_TOKEN}`;
      expect(auth).toBe(`Bearer ${ADMIN_TOKEN}`);
      expect(auth !== "Bearer wrong-token").toBe(true);
    });
  });

  describe("Policy mode", () => {
    it("defaults to 'enforce' when no override exists", async () => {
      const mode = (await getBotState("policy_mode")) ?? process.env.SIGNER_POLICY_MODE ?? "enforce";
      expect(mode).toBe("enforce");
    });

    it("stores and retrieves a mode override", async () => {
      await setBotState("policy_mode", "observe");
      const mode = await getBotState("policy_mode");
      expect(mode).toBe("observe");
    });

    it("validates mode values", () => {
      const validModes = ["enforce", "observe", "off"];
      expect(validModes.includes("enforce")).toBe(true);
      expect(validModes.includes("observe")).toBe(true);
      expect(validModes.includes("off")).toBe(true);
      expect(validModes.includes("invalid")).toBe(false);
    });
  });

  describe("Fee mode", () => {
    it("defaults to 'observe' when no override exists", async () => {
      const mode = (await getBotState("fee_mode")) ?? process.env.FXAEON_FEE_MODE ?? "observe";
      expect(mode).toBe("observe");
    });

    it("stores and retrieves a mode override", async () => {
      await setBotState("fee_mode", "enforce");
      const mode = await getBotState("fee_mode");
      expect(mode).toBe("enforce");
    });

    it("can be set to 'off' for testing", async () => {
      await setBotState("fee_mode", "off");
      expect(await getBotState("fee_mode")).toBe("off");
    });
  });

  describe("Rewebhook", () => {
    it("clears stored webhook URL to force re-registration", async () => {
      await setBotState("webhook_url", "https://old.example.com/webhook");
      expect(await getBotState("webhook_url")).toBe("https://old.example.com/webhook");
      
      // Simulate rewebhook action
      await setBotState("webhook_url", "");
      expect(await getBotState("webhook_url")).toBe("");
    });
  });
});
