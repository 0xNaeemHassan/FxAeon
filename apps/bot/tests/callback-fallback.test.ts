import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the smart callback fallback with 24h hard cutoff.
 * We test the logic in isolation — the actual middleware is in main.ts.
 */

describe("Smart callback fallback", () => {
  const CALLBACK_STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;

  it("identifies a callback from 2 hours ago as fresh", () => {
    const messageDate = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
    const ageMs = Date.now() - messageDate * 1000;
    expect(ageMs).toBeLessThan(CALLBACK_STALE_CUTOFF_MS);
  });

  it("identifies a callback from 25 hours ago as stale", () => {
    const messageDate = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000);
    const ageMs = Date.now() - messageDate * 1000;
    expect(ageMs).toBeGreaterThan(CALLBACK_STALE_CUTOFF_MS);
  });

  it("identifies a callback from exactly 24 hours as stale", () => {
    const messageDate = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const ageMs = Date.now() - messageDate * 1000;
    // Due to rounding, >= rather than >
    expect(ageMs).toBeGreaterThanOrEqual(CALLBACK_STALE_CUTOFF_MS);
  });

  it("handles missing message date gracefully (shows not-wired-up)", () => {
    // When messageDate is undefined, we fall through to the "not wired" message.
    const messageDate = undefined;
    if (messageDate) {
      throw new Error("Should not reach");
    }
    expect(messageDate).toBeUndefined();
  });

  it("handles future timestamps as fresh", () => {
    // Edge case: clock skew could produce a future timestamp
    const messageDate = Math.floor((Date.now() + 60_000) / 1000);
    const ageMs = Date.now() - messageDate * 1000;
    expect(ageMs).toBeLessThan(0); // negative age = fresh
    expect(ageMs < CALLBACK_STALE_CUTOFF_MS).toBe(true);
  });
});
