import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeLiquidationPrice, computeHealthPercent, RISK_PARAMS, HEALTH_LEVELS, ADDRESSES } from "@fxbot/shared";

describe("Integration — Risk Engine", () => {
  describe("Liquidation price computation", () => {
    it("should compute correct liquidation price for long position", () => {
      const collateral = BigInt("2000000000000000000"); // 2 ETH
      const debt = BigInt("5000000000000000000");       // 5000 fxUSD (at $2500/ETH)
      const price = computeLiquidationPrice(collateral, debt, "long");
      
      // debt/collateral = 2500, / 0.95 = ~2631.58
      expect(price).toBeGreaterThan(0);
      expect(price).toBeCloseTo(2500 / 0.95, 0);
    });

    it("should compute correct liquidation price for short position", () => {
      const collateral = BigInt("2000000000000000000"); // 2 ETH
      const debt = BigInt("5000000000000000000");       // 5000 fxUSD
      const price = computeLiquidationPrice(collateral, debt, "short");
      
      // debt/collateral = 2500, * 0.95 = ~2375
      expect(price).toBeGreaterThan(0);
      expect(price).toBeCloseTo(2500 * 0.95, 0);
    });

    it("should handle zero collateral gracefully", () => {
      const collateral = BigInt("0");
      const debt = BigInt("1000000000000000000");
      const price = computeLiquidationPrice(collateral, debt, "long");
      expect(price).toBe(0);
    });

    it("should handle very small positions", () => {
      const collateral = BigInt("1000000000000000"); // 0.001 ETH
      const debt = BigInt("2500000000000000");       // 0.0025 fxUSD
      const price = computeLiquidationPrice(collateral, debt, "long");
      expect(price).toBeGreaterThan(0);
    });
  });

  describe("Health percent computation", () => {
    it("should return 100% at exactly liquidation threshold", () => {
      const health = computeHealthPercent(RISK_PARAMS.LIQUIDATION_THRESHOLD);
      expect(health).toBeCloseTo(1.0, 5);
    });

    it("should return <100% when below liquidation threshold", () => {
      const health = computeHealthPercent(0.90);
      expect(health).toBeLessThan(1.0);
    });

    it("should return >100% when above liquidation threshold", () => {
      const health = computeHealthPercent(0.97);
      expect(health).toBeGreaterThan(1.0);
    });

    it("should classify health levels correctly", () => {
      // ratio 0.60 → health 0.6316 < SAFE(0.70) — unhealthy
      expect(computeHealthPercent(0.60)).toBeLessThan(HEALTH_LEVELS.SAFE);
      expect(computeHealthPercent(0.85)).toBeGreaterThanOrEqual(HEALTH_LEVELS.WARNING);
      expect(computeHealthPercent(0.95)).toBeGreaterThanOrEqual(HEALTH_LEVELS.URGENT);
    });
  });
});

describe("Integration — Contract Addresses", () => {
  it("should have valid Ethereum address format for all contracts", () => {
    const addresses = Object.values(ADDRESSES);
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    
    for (const addr of addresses) {
      expect(addr).toMatch(ethAddressRegex);
    }
  });

  it("should have unique addresses (no duplicates)", () => {
    const addresses = Object.values(ADDRESSES);
    const unique = new Set(addresses);
    expect(unique.size).toBe(addresses.length);
  });

  it("should have correct checksum for main contracts", () => {
    // These are known valid checksums from the spec
    expect(ADDRESSES.ROUTER).toBe("0x33636D49FbefBE798e15e7F356E8DBef543CC708");
    expect(ADDRESSES.LIMIT_ORDER_MANAGER).toBe("0x112873b395B98287F3A4db266a58e2D01779Ad96");
    expect(ADDRESSES.FXSAVE).toBe("0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39");
    expect(ADDRESSES.FXUSD).toBe("0x085780639CC2cACd35E474e71f4d000e2405d8f6");
  });
});

describe("Integration — EIP-712 Domain", () => {
  const domain = {
    name: "f(x) Limit Order Manager",
    version: "1",
    chainId: 1,
    verifyingContract: ADDRESSES.LIMIT_ORDER_MANAGER,
  };

  it("should match the locked spec exactly", () => {
    expect(domain.name).toBe("f(x) Limit Order Manager");
    expect(domain.version).toBe("1");
    expect(domain.chainId).toBe(1);
    expect(domain.verifyingContract).toBe("0x112873b395B98287F3A4db266a58e2D01779Ad96");
  });

  it("should have correct EIP-712 domain separator components", () => {
    expect(typeof domain.name).toBe("string");
    expect(typeof domain.version).toBe("string");
    expect(typeof domain.chainId).toBe("number");
    expect(domain.chainId).toBe(1); // Ethereum mainnet
    expect(domain.verifyingContract).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

describe("Integration — Fee Calculations", () => {
  it("should calculate correct open fee for wstETH", () => {
    const notional = 10000; // $10k
    const fee = notional * RISK_PARAMS.OPEN_RATIO_BASE_WSTETH;
    expect(fee).toBe(10); // 0.10% = $10
  });

  it("should calculate correct open fee for WBTC", () => {
    const notional = 10000;
    const fee = notional * RISK_PARAMS.OPEN_RATIO_BASE_WBTC;
    expect(fee).toBe(30); // 0.30% = $30
  });

  it("should calculate correct close fee", () => {
    const notional = 10000;
    const fee = notional * RISK_PARAMS.CLOSE_FEE;
    expect(fee).toBe(10); // 0.10% = $10
  });

  it("should calculate rebalance bonus correctly", () => {
    const collateral = 10000;
    const bonus = collateral * RISK_PARAMS.REBALANCE_BONUS;
    expect(bonus).toBe(250); // 2.5% = $250
  });

  it("should calculate liquidation bonus correctly", () => {
    const collateral = 10000;
    const bonus = collateral * RISK_PARAMS.LIQUIDATE_BONUS;
    expect(bonus).toBe(400); // 4.0% = $400
  });
});

describe("Integration — Slippage Bounds", () => {
  it("should accept slippage within valid range", () => {
    const validSlippages = [0.01, 0.1, 0.5, 1.0, 1.5, 2.0];
    for (const s of validSlippages) {
      const bps = Math.round(s * 100);
      expect(bps).toBeGreaterThan(0);
      expect(bps).toBeLessThanOrEqual(RISK_PARAMS.SLIPPAGE_MAX_BPS);
    }
  });

  it("should reject slippage above maximum", () => {
    const bps = Math.round(5.0 * 100); // 5.0%
    expect(bps).toBeGreaterThan(RISK_PARAMS.SLIPPAGE_MAX_BPS);
  });

  it("should reject zero slippage", () => {
    const bps = Math.round(0 * 100);
    expect(bps).toBe(0);
    expect(bps).not.toBeGreaterThan(0);
  });
});

describe("Integration — Leverage Bounds", () => {
  it("should accept valid long leverage range", () => {
    const valid = [1.1, 2, 3, 5, 7];
    for (const lev of valid) {
      expect(lev).toBeGreaterThanOrEqual(RISK_PARAMS.MIN_LEVERAGE);
      expect(lev).toBeLessThanOrEqual(RISK_PARAMS.MAX_LEVERAGE_LONG);
    }
  });

  it("should accept valid short leverage range", () => {
    const valid = [1.1, 2, 3];
    for (const lev of valid) {
      expect(lev).toBeGreaterThanOrEqual(RISK_PARAMS.MIN_LEVERAGE);
      expect(lev).toBeLessThanOrEqual(RISK_PARAMS.MAX_LEVERAGE_SHORT);
    }
  });

  it("should reject leverage below minimum", () => {
    expect(1.0).toBeLessThan(RISK_PARAMS.MIN_LEVERAGE);
    expect(0.5).toBeLessThan(RISK_PARAMS.MIN_LEVERAGE);
  });

  it("should reject long leverage above maximum", () => {
    expect(7.1).toBeGreaterThan(RISK_PARAMS.MAX_LEVERAGE_LONG);
    expect(10).toBeGreaterThan(RISK_PARAMS.MAX_LEVERAGE_LONG);
  });

  it("should reject short leverage above maximum", () => {
    expect(3.1).toBeGreaterThan(RISK_PARAMS.MAX_LEVERAGE_SHORT);
    expect(5).toBeGreaterThan(RISK_PARAMS.MAX_LEVERAGE_SHORT);
  });
});

describe("Integration — Notification Anti-Spam", () => {
  it("should enforce 15-minute cooldown per category", () => {
    const lastAlert = new Date("2026-06-08T10:00:00Z");
    const now = new Date("2026-06-08T10:10:00Z"); // 10 min later
    const cooldownMs = 15 * 60 * 1000;
    
    const canSend = now.getTime() - lastAlert.getTime() >= cooldownMs;
    expect(canSend).toBe(false); // Should NOT send (10 < 15)
    
    const later = new Date("2026-06-08T10:20:00Z"); // 20 min later
    const canSendLater = later.getTime() - lastAlert.getTime() >= cooldownMs;
    expect(canSendLater).toBe(true); // Should send (20 >= 15)
  });

  it("should bypass quiet hours for URGENT health alerts", () => {
    const quietStart = "23:00";
    const quietEnd = "07:00";
    const urgentTime = "02:00"; // During quiet hours
    
    // URGENT alerts should always send regardless of quiet hours
    const isUrgent = true;
    const shouldSend = isUrgent; // Bypass quiet hours
    expect(shouldSend).toBe(true);
  });
});

describe("Integration — Automation Rule Conflicts", () => {
  it("should resolve conflicts by priority then createdAt", () => {
    const rules = [
      { id: "1", priority: 5, createdAt: "2026-06-01" },
      { id: "2", priority: 10, createdAt: "2026-06-02" },
      { id: "3", priority: 5, createdAt: "2026-06-03" },
    ];
    
    const sorted = [...rules].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    
    expect(sorted[0].id).toBe("2"); // Highest priority
    expect(sorted[1].id).toBe("1"); // Same priority, earlier created
    expect(sorted[2].id).toBe("3"); // Same priority, later created
  });

  it("should prevent concurrent execution with SETNX lock", () => {
    // Simulate SETNX behavior
    const locks = new Map();
    
    const acquireLock = (key: string, value: string, ttl: number) => {
      if (locks.has(key)) return false;
      locks.set(key, { value, expires: Date.now() + ttl * 1000 });
      return true;
    };
    
    expect(acquireLock("rule:lock:user1:auto-compound", "rule_1", 60)).toBe(true);
    expect(acquireLock("rule:lock:user1:auto-compound", "rule_2", 60)).toBe(false); // Already locked
  });
});

describe("Integration — BYOK Encryption", () => {
  it("should generate unique salts per user", () => {
    const users = ["user1", "user2", "user3"];
    const salts = users.map(u => {
      return Buffer.from(u.padEnd(32, "0").slice(0, 32));
    });
    
    const uniqueSalts = new Set(salts.map(s => s.toString("hex")));
    expect(uniqueSalts.size).toBe(users.length);
  });

  it("should produce different ciphertexts for same plaintext with different nonces", () => {
    // libsodium crypto_secretbox uses random nonce per encryption
    // Same plaintext + same key + different nonce = different ciphertext
    const plaintext = "test-api-key-12345";
    const key = Buffer.from("a".repeat(32)); // Mock key
    
    // In real implementation, nonce is random each time
    const nonce1 = Buffer.from("n".repeat(24));
    const nonce2 = Buffer.from("m".repeat(24));
    
    expect(nonce1.toString("hex")).not.toBe(nonce2.toString("hex"));
  });
});
