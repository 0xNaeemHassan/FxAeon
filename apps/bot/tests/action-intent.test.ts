/**
 * Action-intent token security (core/actionIntent.ts) and the fail-closed
 * target allow-list for earn/borrow routes (fx/earn.ts assertKnownTargets).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ACTION_INTENT_TTL_MS,
  createActionIntent,
  looksLikeActionIntent,
  packAmount,
  unpackAmount,
  verifyActionIntent,
} from "../src/core/actionIntent.js";
import {
  assertKnownTargets,
  assertEthToBase,
  oftAdapterEthereum,
  quoteBridge,
  quoteBridgeFee,
} from "../src/fx/earn.js";
import { __resetConfigForTests } from "../src/middleware/config.js";
import { ADDRESSES } from "@fxbot/shared";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  delete process.env.INTENT_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("packAmount / unpackAmount", () => {
  it("round-trips amounts at micro precision", () => {
    for (const n of [0.000001, 0.5, 1, 1234.567891, 1_000_000]) {
      expect(unpackAmount(packAmount(n))).toBeCloseTo(n, 6);
    }
  });

  it("uses 0 as the ALL sentinel", () => {
    expect(unpackAmount("0")).toBe(0);
  });
});

describe("createActionIntent / verifyActionIntent", () => {
  it("round-trips kind and params and stays within Telegram's 64-byte limit", () => {
    const token = createActionIntent("rp", { p1: "1", p2: (123456).toString(36), p3: packAmount(9999.99) });
    expect(looksLikeActionIntent(token)).toBe(true);
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    const verdict = verifyActionIntent(token);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.intent.kind).toBe("rp");
      expect(verdict.intent.p1).toBe("1");
      expect(parseInt(verdict.intent.p2, 36)).toBe(123456);
      expect(unpackAmount(verdict.intent.p3)).toBeCloseTo(9999.99, 6);
    }
  });

  it("rejects tampered tokens (any field change breaks the signature)", () => {
    const token = createActionIntent("sd", { p1: "f", p2: packAmount(100) });
    const parts = token.split("_");
    // Tamper with the amount field.
    parts[3] = packAmount(1_000_000);
    const verdict = verifyActionIntent(parts.join("_"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("tampered");
  });

  it("rejects expired tokens after the TTL", () => {
    const token = createActionIntent("sc", {});
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + ACTION_INTENT_TTL_MS + 60_000);
    const verdict = verifyActionIntent(token);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("expired");
  });

  it("rejects garbage and truncated tokens", () => {
    for (const bad of ["a1_", "a1_sd_x", "nonsense", createActionIntent("sd", {}).slice(0, -2)]) {
      expect(verifyActionIntent(bad).ok).toBe(false);
    }
  });
});

describe("assertKnownTargets (fail-closed route guard)", () => {
  const tx = (to: string) => ({ to, data: "0x" as const, value: 0n });

  it("passes routes that only touch verified f(x) contracts", () => {
    const txs = assertKnownTargets(
      [tx(ADDRESSES.FXUSD), tx(ADDRESSES.ROUTER), tx(ADDRESSES.FX_MINT_ROUTER), tx(ADDRESSES.FXSAVE)],
      "test"
    );
    expect(txs).toHaveLength(4);
  });

  it("is case-insensitive on addresses", () => {
    expect(assertKnownTargets([tx(ADDRESSES.ROUTER.toLowerCase())], "test")).toHaveLength(1);
  });

  it("throws on any unknown target — the route is rejected before signing", () => {
    expect(() =>
      assertKnownTargets([tx(ADDRESSES.ROUTER), tx("0x000000000000000000000000000000000000dEaD")], "test")
    ).toThrow(/unexpected contract/i);
  });
});

// ── Cross-chain bridge (fx/earn.ts bridge wrappers) ──────────────────────────

describe("bridge: direction gating", () => {
  it("accepts Ethereum → Base", () => {
    expect(() => assertEthToBase(1, 8453)).not.toThrow();
  });
  it("rejects Base → Ethereum with an honest reason", () => {
    expect(() => assertEthToBase(8453, 1)).toThrow(/Base.*Ethereum.*isn't live/i);
  });
  it("rejects unsupported chains", () => {
    expect(() => assertEthToBase(1, 137)).toThrow(/Only Ethereum/i);
  });
});

describe("bridge: OFT adapters", () => {
  it("returns the known fxUSD/fxSAVE OFT adapters", () => {
    expect(oftAdapterEthereum("fxUSD").toLowerCase()).toBe(
      ADDRESSES.FXUSD_OFT_ADAPTER.toLowerCase()
    );
    expect(oftAdapterEthereum("fxSAVE").toLowerCase()).toBe(
      ADDRESSES.FXSAVE_OFT_ADAPTER.toLowerCase()
    );
  });
});

describe("bridge: quoteBridgeFee / quoteBridge", () => {
  const USER = "0x1111111111111111111111111111111111111111" as `0x${string}`;
  const OFT_FXUSD = oftAdapterEthereum("fxUSD");
  const SEND_TX = { to: OFT_FXUSD, data: "0xdeadbeef" as `0x${string}`, value: 203126224121156n };

  const mockSdk = () =>
    ({
      getBridgeQuote: vi.fn().mockResolvedValue({ nativeFee: 203126224121156n, lzTokenFee: 0n }),
      buildBridgeTx: vi
        .fn()
        .mockResolvedValue({ tx: SEND_TX, quote: { nativeFee: SEND_TX.value, lzTokenFee: 0n } }),
    }) as never;

  beforeEach(() => {
    // bridge wrappers read getConfig().ALCHEMY_RPC_URL — give the validator the
    // minimal env it needs (RPC stays unset; the SDK is mocked anyway).
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.DATABASE_URL = "postgres://test";
    __resetConfigForTests();
  });

  it("quoteBridgeFee returns the live LayerZero native fee", async () => {
    const q = await quoteBridgeFee({ sdk: mockSdk(), token: "fxUSD", amountWei: 10n ** 18n, recipient: USER });
    expect(q.nativeFeeWei).toBe(203126224121156n);
    expect(q.oftAdapter.toLowerCase()).toBe(OFT_FXUSD.toLowerCase());
  });

  it("quoteBridgeFee rejects zero amount and bad recipient", async () => {
    await expect(
      quoteBridgeFee({ sdk: mockSdk(), token: "fxUSD", amountWei: 0n, recipient: USER })
    ).rejects.toThrow(/greater than 0/);
    await expect(
      quoteBridgeFee({ sdk: mockSdk(), token: "fxUSD", amountWei: 1n, recipient: "nope" })
    ).rejects.toThrow(/valid address/);
  });

  it("quoteBridge prepends an approve when allowance is short", async () => {
    const { txs, quote } = await quoteBridge({
      sdk: mockSdk(),
      userAddress: USER,
      token: "fxUSD",
      amountWei: 10n ** 18n,
      readAllowance: async () => 0n,
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].to.toLowerCase()).toBe(ADDRESSES.FXUSD.toLowerCase());
    expect(txs[0].value).toBe(0n);
    expect(txs[1].to.toLowerCase()).toBe(OFT_FXUSD.toLowerCase());
    expect(txs[1].value).toBe(SEND_TX.value);
    expect(quote.nativeFeeWei).toBe(SEND_TX.value);
  });

  it("quoteBridge omits the approve when allowance already covers it", async () => {
    const { txs } = await quoteBridge({
      sdk: mockSdk(),
      userAddress: USER,
      token: "fxUSD",
      amountWei: 10n ** 18n,
      readAllowance: async () => 10n ** 30n,
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].to.toLowerCase()).toBe(OFT_FXUSD.toLowerCase());
  });

  it("quoteBridge fails closed on an unexpected send target", async () => {
    const evil = {
      getBridgeQuote: vi.fn().mockResolvedValue({ nativeFee: 1n, lzTokenFee: 0n }),
      buildBridgeTx: vi.fn().mockResolvedValue({
        tx: { to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: 1n },
        quote: { nativeFee: 1n, lzTokenFee: 0n },
      }),
    } as never;
    await expect(
      quoteBridge({ sdk: evil, userAddress: USER, token: "fxUSD", amountWei: 10n ** 18n, readAllowance: async () => 0n })
    ).rejects.toThrow(/unexpected contract/);
  });

  it("the br action-intent round-trips token + amount", () => {
    const token = createActionIntent("br", { p1: "f", p2: (1500000).toString(36) });
    const v = verifyActionIntent(token);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.intent.kind).toBe("br");
    expect(token.length).toBeLessThanOrEqual(64);
  });
});
