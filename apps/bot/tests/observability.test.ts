/**
 * W-15 observability: address masking, metrics, command timing,
 * Sentry scrubbing, SLO digest formatting, vendor log filter.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { maskAddresses, maskDeep } from "../src/middleware/logger";
import { incr, observe, heartbeat, snapshot, __resetMetrics } from "../src/core/metrics";
import { commandName, commandTiming } from "../src/middleware/timing";
import { scrubEvent } from "../src/observability/sentry";
import { formatDigest } from "../src/observability/slo-digest";
import { installVendorLogFilter } from "../src/observability/quiet-vendor";

const ADDR = "0x6B175474E89094C44Da98b954EedeAC495271d0F"; // DAI
const TXHASH = "0x" + "ab".repeat(32); // 66 chars

describe("address masking", () => {
  it("masks a 20-byte address to first/last 4 hex chars", () => {
    expect(maskAddresses(ADDR)).toBe("0x6B17\u2026 1d0F".replace(" ", ""));
  });

  it("does NOT mask 32-byte tx hashes", () => {
    expect(maskAddresses(`receipt ${TXHASH} confirmed`)).toContain(TXHASH);
  });

  it("masks addresses embedded in sentences, multiple times", () => {
    const out = maskAddresses(`from ${ADDR} to ${ADDR}`);
    expect(out).not.toContain(ADDR);
    expect(out.match(/0x6B17\u20261d0F/g)).toHaveLength(2);
  });

  it("maskDeep walks nested objects and arrays", () => {
    const out = maskDeep({ a: { wallets: [ADDR, { addr: ADDR }] }, n: 5 }) as any;
    expect(out.a.wallets[0]).toBe("0x6B17\u20261d0F");
    expect(out.a.wallets[1].addr).toBe("0x6B17\u20261d0F");
    expect(out.n).toBe(5);
  });

  it("maskDeep masks Error messages without losing the Error", () => {
    const out = maskDeep(new Error(`failed for ${ADDR}`)) as Error;
    expect(out).toBeInstanceOf(Error);
    expect(out.message).not.toContain(ADDR);
  });
});

describe("metrics", () => {
  beforeEach(() => __resetMetrics());

  it("counts and summarizes timings with percentiles", () => {
    incr("cmd.trade");
    incr("cmd.trade");
    for (let i = 1; i <= 100; i++) observe("cmd.trade", i);
    const s = snapshot();
    expect(s.counters["cmd.trade"]).toBe(2);
    expect(s.timings["cmd.trade"].count).toBe(100);
    expect(s.timings["cmd.trade"].p50).toBe(50);
    expect(s.timings["cmd.trade"].p95).toBe(95);
    expect(s.timings["cmd.trade"].max).toBe(100);
  });

  it("reports null for workers that never beat, seconds for those that did", () => {
    heartbeat("limit-order-poller");
    const s = snapshot(["health-monitor", "limit-order-poller"]);
    expect(s.workers["health-monitor"]).toBeNull();
    expect(s.workers["limit-order-poller"]).toBeLessThanOrEqual(1);
  });
});

describe("command timing middleware", () => {
  beforeEach(() => __resetMetrics());

  const ctx = (text?: string) => ({ message: text ? { text } : undefined }) as any;

  it("extracts command names, handles @botname and args", () => {
    expect(commandName(ctx("/trade 5x long"))).toBe("trade");
    expect(commandName(ctx("/portfolio@FxAeonBot"))).toBe("portfolio");
    expect(commandName(ctx("hello"))).toBeNull();
    expect(commandName(ctx())).toBeNull();
  });

  it("records count + duration for commands", async () => {
    await commandTiming(ctx("/trade"), async () => {});
    const s = snapshot();
    expect(s.counters["cmd.trade"]).toBe(1);
    expect(s.timings["cmd.trade"].count).toBe(1);
  });

  it("counts errors separately and rethrows", async () => {
    await expect(
      commandTiming(ctx("/mint"), async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const s = snapshot();
    expect(s.counters["cmd.mint.error"]).toBe(1);
  });

  it("passes non-command updates straight through", async () => {
    let called = false;
    await commandTiming(ctx("just text"), async () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(Object.keys(snapshot().counters)).toHaveLength(0);
  });
});

describe("sentry scrubbing", () => {
  it("drops request/user and masks addresses in exception values", () => {
    const event: any = {
      request: { headers: { authorization: "Bearer x" } },
      user: { id: "123" },
      message: `bad addr ${ADDR}`,
      exception: { values: [{ value: `revert for ${ADDR}` }] },
      breadcrumbs: [{ message: `sent to ${ADDR}`, data: { secret: "y" } }],
      extra: { wallet: ADDR, obj: { deep: true } },
    };
    const out: any = scrubEvent(event);
    expect(out.request).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.message).not.toContain(ADDR);
    expect(out.exception.values[0].value).not.toContain(ADDR);
    expect(out.breadcrumbs[0].message).not.toContain(ADDR);
    expect(out.breadcrumbs[0].data).toBeUndefined();
    expect(out.extra.wallet).not.toContain(ADDR);
    expect(out.extra.obj).toBe("[scrubbed]");
  });
});

describe("SLO digest", () => {
  beforeEach(() => __resetMetrics());

  it("summarizes commands, sims, notifications, and worker status", () => {
    incr("cmd.trade");
    incr("cmd.trade");
    observe("cmd.trade", 120);
    incr("cmd.mint.error");
    incr("simulate.ok", 7);
    incr("simulate.revert");
    incr("notify.sent", 3);
    heartbeat("health-monitor");
    const text = formatDigest(new Date("2026-06-11T00:00:00Z"));
    expect(text).toContain("2026-06-11");
    expect(text).toContain("Commands: 2 handled, 1 errors");
    expect(text).toContain("/trade: 2× (p95 120ms)");
    expect(text).toContain("Simulations: 7 ok, 1 reverted");
    expect(text).toContain("Notifications: 3 sent, 0 failed");
    expect(text).toContain("health-monitor: ok");
    expect(text).toContain("limit-order-poller: never ran");
  });
});

describe("vendor log filter", () => {
  it("drops only the fx-sdk poolData line", () => {
    const original = console.log;
    const seen: unknown[][] = [];
    console.log = (...args: unknown[]) => void seen.push(args);
    try {
      installVendorLogFilter();
      console.log("poolData-->", { huge: "struct" });
      console.log("normal line");
      expect(seen).toHaveLength(1);
      expect(seen[0][0]).toBe("normal line");
    } finally {
      console.log = original;
    }
  });
});
