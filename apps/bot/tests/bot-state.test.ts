import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma with botState model
const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@fxaeon/db", () => ({
  prisma: {
    botState: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    feeLedger: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { usdAmount: 0, notionalUsd: 0 }, _count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    txRecord: {
      count: vi.fn().mockResolvedValue(0),
    },
    position: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import {
  getBotState,
  setBotState,
  BS_WEBHOOK_URL,
  BS_WEBHOOK_SECRET,
  BS_DEPLOY_ID,
  BS_FEE_MODE,
  BS_POLICY_MODE,
} from "../src/core/botState";

describe("BotState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("getBotState returns null when key not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await getBotState("nonexistent");
    expect(result).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: "nonexistent" } });
  });

  it("getBotState returns stored value", async () => {
    mockFindUnique.mockResolvedValue({ key: "test", value: "hello", updatedAt: new Date() });
    const result = await getBotState("test");
    expect(result).toBe("hello");
  });

  it("setBotState upserts the key/value pair", async () => {
    mockUpsert.mockResolvedValue({ key: "test", value: "world" });
    await setBotState("test", "world");
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "test" },
      update: { value: "world" },
      create: { key: "test", value: "world" },
    });
  });

  it("exports well-known key constants", () => {
    expect(BS_WEBHOOK_URL).toBe("webhook_url");
    expect(BS_WEBHOOK_SECRET).toBe("webhook_secret");
    expect(BS_DEPLOY_ID).toBe("deploy_id");
    expect(BS_FEE_MODE).toBe("fee_mode");
    expect(BS_POLICY_MODE).toBe("policy_mode");
  });
});
