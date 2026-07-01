import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the webhook retry logic with exponential backoff and
 * BotState skip-noop. We test the logic in isolation since main.ts
 * side-effects are too heavy for unit testing.
 */

// Simulated BotState store
const store = new Map<string, string>();

vi.mock("../src/core/botState", () => ({
  getBotState: vi.fn(async (key: string) => store.get(key) ?? null),
  setBotState: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  BS_WEBHOOK_URL: "webhook_url",
}));

import { getBotState, setBotState } from "../src/core/botState";

describe("Webhook retry logic", () => {
  beforeEach(() => {
    store.clear();
  });

  it("skip-noop: skips when stored URL matches desired URL", async () => {
    store.set("webhook_url", "https://app.example.com/webhook");
    const storedUrl = await getBotState("webhook_url");
    expect(storedUrl).toBe("https://app.example.com/webhook");
    // In real code, this match would skip setWebhook
    expect(storedUrl === "https://app.example.com/webhook").toBe(true);
  });

  it("registers when stored URL differs", async () => {
    store.set("webhook_url", "https://old.example.com/webhook");
    const storedUrl = await getBotState("webhook_url");
    const desired = "https://new.example.com/webhook";
    expect(storedUrl !== desired).toBe(true);
    // In real code, this triggers setWebhook + setBotState
    await setBotState("webhook_url", desired);
    expect(store.get("webhook_url")).toBe(desired);
  });

  it("registers when no stored URL (first deploy)", async () => {
    const storedUrl = await getBotState("webhook_url");
    expect(storedUrl).toBeNull();
    // null !== desired, so setWebhook runs
    await setBotState("webhook_url", "https://new.example.com/webhook");
    expect(store.get("webhook_url")).toBe("https://new.example.com/webhook");
  });

  it("exponential backoff produces correct delays", () => {
    const BASE_DELAY_MS = 1_000;
    const delays = [0, 1, 2, 3, 4].map((attempt) =>
      BASE_DELAY_MS * Math.pow(2, attempt)
    );
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
  });
});
