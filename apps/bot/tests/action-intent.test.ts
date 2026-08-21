/**
 * Action-intent token security (core/actionIntent.ts) and the fail-closed
 * target allow-list for earn/borrow routes (fx/earn.ts assertKnownTargets).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ACTION_INTENT_TTL_MS,
  canonicalActionAmount,
  createActionIntent,
  looksLikeActionIntent,
  packAmount,
  unpackAmount,
  verifyActionIntent,
} from "../src/core/actionIntent.js";
import {
  assertKnownTargets,
  assertEthToBase,
  oftAdapterForChain,
  oftAdapterEthereum,
  quoteBridge,
  quoteBridgeFee,
  resolveBridgeRoute,
} from "../src/fx/earn.js";
import { __resetConfigForTests } from "../src/middleware/config.js";
import { ADDRESSES } from "@fxaeon/shared";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  delete process.env.INTENT_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("packAmount / unpackAmount", () => {
  it("round-trips decimal strings exactly, including 18-decimal amounts", () => {
    for (const n of [
      "0.000000000000000001",
      "0.000001",
      "0.5",
      "1",
      "1234.567891",
      "9007199254740993.123456789012345678",
    ]) {
      expect(unpackAmount(packAmount(n))).toBe(n);
    }
  });

  it("uses 0 as the ALL sentinel", () => {
    expect(unpackAmount("0")).toBe("0");
  });

  it("canonicalizes plain decimals and rejects lossy or ambiguous inputs", () => {
    expect(canonicalActionAmount("001,234.5600", 6)).toBe("1234.56");
    expect(canonicalActionAmount(".000001", 6)).toBe("0.000001");
    for (const raw of ["0", "1e-6", "+1", "-1", "12,34", "1.0000001"]) {
      expect(canonicalActionAmount(raw, 6), raw).toBeNull();
    }
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
      expect(unpackAmount(verdict.intent.p3)).toBe("9999.99");
    }
  });

  it("keeps two exact 18-decimal mint amounts inside Telegram's limit", () => {
    const token = createActionIntent("mt", {
      p1: "0",
      p2: packAmount("0.123456789012345678"),
      p3: packAmount("1500.123456789012345678"),
    });
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    const verdict = verifyActionIntent(token);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(unpackAmount(verdict.intent.p2)).toBe("0.123456789012345678");
      expect(unpackAmount(verdict.intent.p3)).toBe("1500.123456789012345678");
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
  it("accepts and normalizes both bridge directions", () => {
    expect(resolveBridgeRoute(1, 8453)).toEqual({ sourceChainId: 1, destChainId: 8453 });
    expect(resolveBridgeRoute(8453, 1)).toEqual({ sourceChainId: 8453, destChainId: 1 });
    expect(resolveBridgeRoute(8453)).toEqual({ sourceChainId: 8453, destChainId: 1 });
  });
  it("retains the Telegram legacy Ethereum-to-Base guard", () => {
    expect(() => assertEthToBase(1, 8453)).not.toThrow();
    expect(() => assertEthToBase(8453, 1)).toThrow(/legacy flow/i);
  });
  it("rejects unsupported or same-chain routes", () => {
    expect(() => resolveBridgeRoute(1, 137)).toThrow(/destination chainId/i);
    expect(() => resolveBridgeRoute(8453, 8453)).toThrow(/must differ/i);
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
    process.env.ALCHEMY_RPC_URL = "https://eth.example.test";
    process.env.BASE_RPC_URL = "https://base.example.test";
    __resetConfigForTests();
  });

  it("quoteBridgeFee returns the live LayerZero native fee", async () => {
    const q = await quoteBridgeFee({ sdk: mockSdk(), token: "fxUSD", amountWei: 10n ** 18n, recipient: USER });
    expect(q.nativeFeeWei).toBe(203126224121156n);
    expect(q.sourceChainId).toBe(1);
    expect(q.destChainId).toBe(8453);
    expect(q.oftAdapter.toLowerCase()).toBe(OFT_FXUSD.toLowerCase());
  });

  it("quotes Base -> Ethereum against the configured Base RPC and Base OFT", async () => {
    const sdk = mockSdk();
    const q = await quoteBridgeFee({
      sdk,
      token: "fxSAVE",
      amountWei: 10n ** 18n,
      recipient: USER,
      sourceChainId: 8453,
      destChainId: 1,
    });
    expect(q).toMatchObject({
      sourceChainId: 8453,
      destChainId: 1,
      oftAdapter: oftAdapterForChain("fxSAVE", 8453),
    });
    expect((sdk as { getBridgeQuote: ReturnType<typeof vi.fn> }).getBridgeQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChainId: 8453,
        destChainId: 1,
        sourceRpcUrl: "https://base.example.test",
      })
    );
  });

  it("quoteBridgeFee rejects zero amount and bad recipient", async () => {
    await expect(
      quoteBridgeFee({ sdk: mockSdk(), token: "fxUSD", amountWei: 0n, recipient: USER })
    ).rejects.toThrow(/at least 0\.0001/);
    await expect(
      quoteBridgeFee({ sdk: mockSdk(), token: "fxUSD", amountWei: 10n ** 18n, recipient: "nope" })
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

  it("builds Base -> Ethereum as one OFT send without reading allowance", async () => {
    const baseOft = oftAdapterForChain("fxUSD", 8453);
    const readAllowance = vi.fn().mockRejectedValue(new Error("must not be called on Base"));
    const sdk = {
      buildBridgeTx: vi.fn().mockResolvedValue({
        tx: { to: baseOft, data: "0xdeadbeef", value: 42n },
        quote: { nativeFee: 42n, lzTokenFee: 0n },
      }),
    } as never;
    const { txs, quote } = await quoteBridge({
      sdk,
      userAddress: USER,
      token: "fxUSD",
      amountWei: 10n ** 18n,
      sourceChainId: 8453,
      destChainId: 1,
      readAllowance,
    });
    expect(readAllowance).not.toHaveBeenCalled();
    expect(txs).toEqual([{ to: baseOft, data: "0xdeadbeef", value: 42n }]);
    expect(quote).toMatchObject({ sourceChainId: 8453, destChainId: 1, oftAdapter: baseOft });
  });

  it("fails closed when SDK tx value and quoted native fee diverge", async () => {
    const sdk = {
      buildBridgeTx: vi.fn().mockResolvedValue({
        tx: { to: OFT_FXUSD, data: "0xdeadbeef", value: 43n },
        quote: { nativeFee: 42n, lzTokenFee: 0n },
      }),
    } as never;
    await expect(
      quoteBridge({
        sdk,
        userAddress: USER,
        token: "fxUSD",
        amountWei: 10n ** 18n,
        readAllowance: async () => 10n ** 30n,
      })
    ).rejects.toThrow(/does not match/i);
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
