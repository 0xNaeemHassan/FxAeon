import { z } from "zod";
import { logger } from "./logger.js";

/**
 * Core env vars required for the bot to start at all (Telegram + DB).
 * Development can omit external services for isolated UI/tests. Production is
 * the transactional product and therefore fails fast unless its Ethereum RPC
 * and complete Privy signing quorum are configured.
 */
export const envSchema = z.object({
  // ── Core (required) ──────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  INTENT_SECRET: z.string().min(32, "must contain at least 32 characters").optional(),
  PORT: z.string().default("8080"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // ── Privy (wallet creation & auth) ───────────────────────
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PRIVY_AUTHORIZATION_KEY: z.string().min(1).optional(),

  // ── Blockchain / RPC ─────────────────────────────────────
  ALCHEMY_RPC_URL: z.string().url().optional(),
  /** Base mainnet RPC used for Base -> Ethereum bridge quotes and execution. */
  BASE_RPC_URL: z.string().url().optional(),

  // ── Redis (distributed rate limits and transaction caps) ───────────────
  REDIS_URL: z.string().min(1).optional(),

  // ── Encryption ───────────────────────────────────────────
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // ── Webhook authentication ───────────────────────────────
  TELEGRAM_WEBHOOK_SECRET: z.string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/, "must be 32-256 characters using only A-Z, a-z, 0-9, _ or -")
    .optional(),

  // ── Webhook URL (production webhook mode) ────────────────
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  WEBHOOK_URL: z.string().url().optional(),

  // ── Observability (W-15) ─────────────────────────────────
  SENTRY_DSN: z.string().url().optional(),
  /** Operator chat for the daily SLO digest; digest disabled when unset. */
  ADMIN_TELEGRAM_CHAT_ID: z.string().optional(),
  /** Optional operator bearer token; routes remain disabled when unset. */
  ADMIN_TOKEN: z.string().min(32, "must contain at least 32 characters").optional(),

  // ── Optional services ────────────────────────────────────
  /** CoinGecko demo API key for /price; works unauthenticated at lower limits. */
  COINGECKO_API_KEY: z.string().optional(),
  /** Etherscan API key for /gas (gas oracle, ETH price, gas estimates). */
  ETHERSCAN_API_KEY: z.string().optional(),
  MINI_APP_URL: z.string().url().default("http://localhost:3000"),
  DAILY_TX_CAP: z.string().default("50"),
  /**
   * Cross-chain bridge (Ethereum → Base) on-chain execution kill-switch.
   * OFF by default. Bidirectional execution requires explicit Ethereum and
   * Base RPCs; every route is still checked against its source-chain policy.
   */
  BRIDGE_EXECUTION_ENABLED: z.enum(["true", "false"]).default("false"),
  /**
   * Session-signer broadcast policy mode (PLAN.md Pillar A §3.4).
   * "enforce" (default): a route that targets anything outside the verified
   * f(x) ADDRESSES registry — or approves/sends to a non-allow-listed address —
   * is refused before broadcast (fail-closed). "observe": such a route is
   * counted + logged but still broadcast (operational safety valve for a new,
   * verified f(x) peripheral — see docs/GAPS.md). "off": disabled (tests only).
   */
  SIGNER_POLICY_MODE: z.enum(["enforce", "observe", "off"]).default("enforce"),
}).superRefine((cfg, ctx) => {
  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const isHttpsOrigin = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password;
    } catch {
      return false;
    }
  };

  if (cfg.BRIDGE_EXECUTION_ENABLED.toLowerCase() === "true") {
    if (!cfg.ALCHEMY_RPC_URL) {
      fail("ALCHEMY_RPC_URL", "required when BRIDGE_EXECUTION_ENABLED=true (Ethereum source RPC)");
    }
    if (!cfg.BASE_RPC_URL) {
      fail("BASE_RPC_URL", "required when BRIDGE_EXECUTION_ENABLED=true (Base source RPC)");
    }
  }

  // ── Production fail-fast (PLAN.md W-05) ────────────────────────────────
  // A money-touching bot must not boot into a silently-degraded state.
  // Anything security-critical that is missing kills the process at startup
  // with an explicit list of what to set.
  if (cfg.NODE_ENV !== "production") return;

  if (!cfg.TELEGRAM_WEBHOOK_SECRET) {
    fail("TELEGRAM_WEBHOOK_SECRET",
      "required in production — webhook auth (generate with: openssl rand -hex 32)");
  }
  if (!cfg.ENCRYPTION_KEY) {
    fail("ENCRYPTION_KEY",
      "required in production — at-rest encryption key (generate with: openssl rand -hex 32)");
  }
  if (!cfg.INTENT_SECRET) {
    fail("INTENT_SECRET", "required in production — use a dedicated HMAC key, not the Telegram bot token");
  }
  if (!cfg.RENDER_EXTERNAL_URL && !cfg.WEBHOOK_URL) {
    fail("WEBHOOK_URL",
      "set RENDER_EXTERNAL_URL or WEBHOOK_URL in production — otherwise the Telegram webhook is never registered and the bot is unreachable");
  }
  const webhookBase = cfg.RENDER_EXTERNAL_URL ?? cfg.WEBHOOK_URL;
  if (webhookBase && !isHttpsOrigin(webhookBase)) {
    fail("WEBHOOK_URL", "must be a credential-free HTTPS origin with no path, query, or fragment");
  }
  if (!isHttpsOrigin(cfg.MINI_APP_URL)) {
    fail("MINI_APP_URL", "must be explicitly configured as a credential-free HTTPS origin in production");
  }
  if (cfg.SIGNER_POLICY_MODE !== "enforce") {
    fail("SIGNER_POLICY_MODE", "must be 'enforce' in production");
  }
  if (!cfg.ALCHEMY_RPC_URL) {
    fail("ALCHEMY_RPC_URL", "required in production for live quotes, simulation and Ethereum receipts");
  }
  if (!cfg.PRIVY_APP_ID) {
    fail("PRIVY_APP_ID", "required in production for authenticated wallet ownership");
  }
  if (!cfg.PRIVY_APP_SECRET) {
    fail("PRIVY_APP_SECRET", "required in production for Privy server authentication");
  }
  if (!cfg.PRIVY_AUTHORIZATION_KEY) {
    fail("PRIVY_AUTHORIZATION_KEY", "required in production for delegated-wallet transaction signing");
  }
  // PRIVY_WEBHOOK_SECRET intentionally is not required: receipt lifecycle is
  // reconciled from our own RPC after every server broadcast.
});

export type Env = z.infer<typeof envSchema>;
let validatedEnv: Env | null = null;

export function validateConfig(): Env {
  if (validatedEnv) return validatedEnv;
  try {
    validatedEnv = envSchema.parse(process.env);
    logger.info(
      { nodeEnv: validatedEnv.NODE_ENV, logLevel: validatedEnv.LOG_LEVEL },
      "Configuration validated — core env OK",
    );

    // Warn about missing optional vars so operators know what's disabled
    const optionalChecks: [string, unknown, string][] = [
      ["PRIVY_APP_ID", validatedEnv.PRIVY_APP_ID, "Wallet creation disabled"],
      ["PRIVY_APP_SECRET", validatedEnv.PRIVY_APP_SECRET, "Privy auth disabled"],
      ["PRIVY_AUTHORIZATION_KEY", validatedEnv.PRIVY_AUTHORIZATION_KEY, "Privy wallet API disabled"],
      ["ALCHEMY_RPC_URL", validatedEnv.ALCHEMY_RPC_URL, "Blockchain RPC calls disabled"],
      ["BASE_RPC_URL", validatedEnv.BASE_RPC_URL, "Base bridge quotes and execution disabled"],
      ["REDIS_URL", validatedEnv.REDIS_URL, "Distributed rate limits and tx-cap cache disabled"],
      ["ENCRYPTION_KEY", validatedEnv.ENCRYPTION_KEY, "At-rest encryption disabled"],
      ["INTENT_SECRET", validatedEnv.INTENT_SECRET, "Dedicated action-intent key absent; development falls back to the bot token"],
    ];
    for (const [key, value, impact] of optionalChecks) {
      if (!value) {
        logger.warn({ key }, `${key} not set — ${impact}`);
      }
    }

    return validatedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      logger.fatal({ issues }, "Configuration validation failed");
      throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
    }
    throw error;
  }
}

export function getConfig(): Env {
  if (!validatedEnv) return validateConfig();
  return validatedEnv;
}

/** Test hook — clear the cached env so tests can vary process.env. */
export function __resetConfigForTests(): void {
  validatedEnv = null;
}

/** Feature flags derived from available env vars */
export const features = {
  get enablePrivy() { return !!(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET); },
  get enablePrivyWalletApi() { return !!(features.enablePrivy && process.env.PRIVY_AUTHORIZATION_KEY); },
  get enableBlockchain() { return !!process.env.ALCHEMY_RPC_URL; },
  get enableBaseBlockchain() { return !!process.env.BASE_RPC_URL; },
  get enableRedis() { return /^rediss?:\/\//i.test(process.env.REDIS_URL ?? ""); },
  get enableEncryption() { return !!process.env.ENCRYPTION_KEY; },
  enableByok: true,
  enableFlashbots: true,
  enableNotifications: true,
  enableAutomation: true,
  enableReferrals: true,
  enableHealthAlerts: true,
  /** Etherscan gas oracle + ETH price for /gas. */
  get enableEtherscan() { return !!process.env.ETHERSCAN_API_KEY; },
  /** Bridge quote/build/broadcast gate — off means no actionable review. */
  get enableBridgeExecution() {
    return (
      (process.env.BRIDGE_EXECUTION_ENABLED ?? "false").toLowerCase() === "true" &&
      !!process.env.ALCHEMY_RPC_URL &&
      !!process.env.BASE_RPC_URL
    );
  },
};
