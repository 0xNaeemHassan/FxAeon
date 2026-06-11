/**
 * W-12 — resilience primitives, the notify() gate, and poller status mapping.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@fxbot/db";
import { withTimeout, withRetry, CircuitBreaker } from "../src/utils/resilience.js";
import { notify, initNotify, inQuietHours, __resetNotifyForTests } from "../src/notifications/notify.js";
import { mapRelayStatus } from "../src/notifications/limit-order-poller.js";

function mockPrefs(overrides: object | null) {
  (prisma.notificationPref as unknown as Record<string, ReturnType<typeof vi.fn>>) = {
    findUnique: vi.fn().mockResolvedValue(overrides),
    update: vi.fn().mockResolvedValue({}),
  };
  (prisma.auditLog as unknown as Record<string, ReturnType<typeof vi.fn>>) = {
    create: vi.fn().mockResolvedValue({}),
  };
}

const BASE_PREFS = {
  tx: true, orders: true, health: true, rewards: false, governance: false, rules: true,
  quietHoursStart: null, quietHoursEnd: null,
  lastTxAlert: null, lastOrderAlert: null, lastHealthAlert: null,
  lastRewardsAlert: null, lastGovernanceAlert: null, lastRulesAlert: null,
};

describe("resilience", () => {
  it("withTimeout rejects slow promises and passes fast ones", async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 100, "late")), 10, "x")).rejects.toThrow(/timed out/);
    await expect(withTimeout(Promise.resolve("ok"), 100, "x")).resolves.toBe("ok");
  });

  it("withRetry retries transient errors with backoff but not fatal ones", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValue("ok");
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);

    const fatal = vi.fn().mockRejectedValue(new Error("400 bad request"));
    await expect(
      withRetry(fatal, { attempts: 3, baseDelayMs: 1, isFatal: (e) => String(e).includes("400") })
    ).rejects.toThrow(/400/);
    expect(fatal).toHaveBeenCalledTimes(1);
  });

  it("circuit breaker opens after threshold, half-opens after cooldown, closes on probe success", async () => {
    vi.useFakeTimers();
    try {
      const breaker = new CircuitBreaker("test", 2, 1000);
      const boom = () => Promise.reject(new Error("down"));
      await expect(breaker.run(boom)).rejects.toThrow("down");
      await expect(breaker.run(boom)).rejects.toThrow("down");
      expect(breaker.state).toBe("open");
      // while open, calls are short-circuited (fn never invoked)
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(breaker.run(fn)).rejects.toThrow(/is open/);
      expect(fn).not.toHaveBeenCalled();
      // cooldown elapses → half-open lets one probe through; success closes
      vi.advanceTimersByTime(1001);
      expect(breaker.state).toBe("half-open");
      await expect(breaker.run(fn)).resolves.toBe("ok");
      expect(breaker.state).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("inQuietHours", () => {
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 5, 11, h, m));
  it("handles plain and midnight-wrapping windows in UTC", () => {
    expect(inQuietHours("22:00", "07:00", at(23, 30))).toBe(true);
    expect(inQuietHours("22:00", "07:00", at(3, 0))).toBe(true);
    expect(inQuietHours("22:00", "07:00", at(12, 0))).toBe(false);
    expect(inQuietHours("09:00", "17:00", at(10, 0))).toBe(true);
    expect(inQuietHours("09:00", "17:00", at(8, 59))).toBe(false);
  });
  it("treats missing/garbage windows as no quiet hours", () => {
    expect(inQuietHours(null, null, at(3, 0))).toBe(false);
    expect(inQuietHours("25:99", "07:00", at(3, 0))).toBe(false);
    expect(inQuietHours("07:00", "07:00", at(7, 0))).toBe(false);
  });
});

describe("notify gate", () => {
  const params = { userId: "u1", telegramId: "12345", kind: "health" as const, message: "hi" };
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetNotifyForTests();
    send = vi.fn().mockResolvedValue({});
    initNotify(send);
    mockPrefs({ ...BASE_PREFS });
  });

  it("refuses to send before initNotify is wired", async () => {
    __resetNotifyForTests();
    await expect(notify(params)).resolves.toBe("skipped:uninitialized");
  });

  it("sends when enabled, then records last-alert + AuditLog AFTER delivery", async () => {
    await expect(notify(params)).resolves.toBe("sent");
    expect(send).toHaveBeenCalledWith("12345", "hi");
    expect(prisma.notificationPref.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastHealthAlert: expect.any(Date) } })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("NEVER writes AuditLog when delivery fails", async () => {
    send.mockRejectedValue(new Error("telegram down"));
    await expect(notify(params)).resolves.toBe("failed");
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationPref.update).not.toHaveBeenCalled();
  });

  it("respects per-kind opt-out and schema defaults for missing pref rows", async () => {
    mockPrefs({ ...BASE_PREFS, health: false });
    await expect(notify(params)).resolves.toBe("skipped:pref");
    // no pref row: health defaults true, rewards defaults false
    mockPrefs(null);
    await expect(notify(params)).resolves.toBe("sent");
    await expect(notify({ ...params, kind: "rewards" })).resolves.toBe("skipped:pref");
  });

  it("respects quiet hours but lets urgent health bypass them", async () => {
    const allDay = { quietHoursStart: "00:00", quietHoursEnd: "23:59" };
    mockPrefs({ ...BASE_PREFS, ...allDay });
    await expect(notify(params)).resolves.toBe("skipped:quiet");
    await expect(notify({ ...params, kind: "health_urgent" })).resolves.toBe("sent");
  });

  it("throttles repeated health alerts via lastHealthAlert", async () => {
    mockPrefs({ ...BASE_PREFS, lastHealthAlert: new Date(Date.now() - 60_000) });
    await expect(notify(params)).resolves.toBe("skipped:throttle"); // 30-min window
    await expect(notify({ ...params, kind: "health_urgent" })).resolves.toBe("skipped:throttle"); // 10-min window
    mockPrefs({ ...BASE_PREFS, lastHealthAlert: new Date(Date.now() - 31 * 60_000) });
    await expect(notify(params)).resolves.toBe("sent");
  });

  it("a delivered notification survives audit-logging failures", async () => {
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    await expect(notify(params)).resolves.toBe("sent");
  });
});

describe("limit-order poller status mapping", () => {
  it("maps relay execution states to our DB statuses", () => {
    expect(mapRelayStatus({ execution: { status: 2 } })).toBe("filled");
    expect(mapRelayStatus({ execution: { status: 3 } })).toBe("cancelled");
    expect(mapRelayStatus({ expired: true })).toBe("expired");
    expect(mapRelayStatus({ execution: { status: 0 } })).toBeNull();
    expect(mapRelayStatus({ execution: { status: 1 } })).toBeNull(); // partial fills stay open
    expect(mapRelayStatus({})).toBeNull();
  });
});
