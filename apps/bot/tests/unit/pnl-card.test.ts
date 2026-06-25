import { describe, it, expect } from "vitest";
import { formatPnlCard } from "../../src/core/pnl.js";
const basePos = { market: "wstETH", side: "long", positionId: 3, leverage: 2 } as const;

describe("formatPnlCard", () => {
  it("renders a profitable LONG card with pct, usd and entry", () => {
    const card = formatPnlCard(
      basePos,
      { pnlUsd: 420, pnlPct: 12, since: new Date() },
      { entrySpotUsd: 3400 } as never
    );
    expect(card).toMatch(/🟢/);
    expect(card).toMatch(/LONG #3 · 2.00x/);
    expect(card).toMatch(/\+12.0% PnL/);
    expect(card).toMatch(/\+\$420.00/);
    expect(card).toMatch(/Entry: \$3,400/);
  });

  it("renders a losing SHORT card", () => {
    const card = formatPnlCard(
      { ...basePos, side: "short" },
      { pnlUsd: -150.5, pnlPct: -8.2, since: new Date() },
      undefined
    );
    expect(card).toMatch(/🔴/);
    expect(card).toMatch(/SHORT #3/);
    expect(card).toMatch(/−8.2% PnL/);
    expect(card).toMatch(/−\$150.50/);
    expect(card).not.toMatch(/Entry:/);
  });

  it("handles null estimate gracefully", () => {
    expect(formatPnlCard(basePos, null)).toMatch(/n\/a/);
  });

  it("omits pct when entry equity is ~0", () => {
    const card = formatPnlCard(basePos, { pnlUsd: 10, pnlPct: null, since: new Date() });
    expect(card).not.toMatch(/% PnL/);
    expect(card).toMatch(/\+\$10.00/);
  });
});
