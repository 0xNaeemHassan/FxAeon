import { z } from "zod";
import { logger } from "./logger.js";

/**
 * Core env vars required for the bot to start at all (Telegram + DB).
 * Everything else is optional — missing keys disable the corresponding feature
 * but the bot still boots and responds to commands.
 */
export const envSchema = z.object({
  // ── Core (required) ──────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PORT: z.string().default("8080"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // ── Privy (wallet creation & auth) ───────────────────────
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PRIVY_AUTHORIZATION_KEY: z.string().min(1).optional(),
  /** Pinned Privy Policy Engine policy ID (created once via walletPolicy.ts). */
  PRIVY_POLICY_ID: z.string().min(1).optional(),

  // ── Blockchain / RPC ─────────────────────────────────────
  ALCHEMY_RPC_URL: z.string().url().optional(),

  // ── Redis (rate limiting, queues, caching) ───────────────
  REDIS_URL: z.string().min(1).optional(),

  // ── Encryption ───────────────────────────────────────────
  KMS_MASTER_KEY: z.string().length(64).optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // ── Webhook authentication ───────────────────────────────
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32).optional(),
  PRIVY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ── Webhook URL (production webhook mode) ────────────────
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  WEBHOOK_URL: z.string().url().optional(),

  // ── Optional services ────────────────────────────────────
  SURPLUS_API_KEY: z.string().optional(),
  MINI_APP_URL: z.string().url().default("https://fxbot-mini-app.pages.dev"),
  DAILY_TX_CAP: z.string().default("50"),
}).superRefine((cfg, ctx) => {
  // ── Production fail-fast (PLAN.md W-05) ────────────────────────────────
  // A money-touching bot must not boot into a silently-degraded state.
  // Anything security-critical that is missing kills the process at startup
  // with an explicit list of what to set.
  if (cfg.NODE_ENV !== "production") return;

  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (!cfg.TELEGRAM_WEBHOOK_SECRET) {
    fail("TELEGRAM_WEBHOOK_SECRET",
      "required in production — webhook auth (generate with: openssl rand -hex 32)");
  }
  if (!cfg.ENCRYPTION_KEY) {
    fail("ENCRYPTION_KEY",
      "required in production — at-rest encryption key (generate with: openssl rand -hex 32)");
  }
  if (!cfg.RENDER_EXTERNAL_URL && !cfg.WEBHOOK_URL) {
    fail("WEBHOOK_URL",
      "set RENDER_EXTERNAL_URL or WEBHOOK_URL in production — otherwise the Telegram webhook is never registered and the bot is unreachable");
  }
  // Privy is optional as a feature, but if it is configured at all it must be
  // configured completely — a partial config means signed webhooks get
  // rejected or wallet auth half-works.
  if (cfg.PRIVY_APP_ID || cfg.PRIVY_APP_SECRET) {
    if (!cfg.PRIVY_APP_ID) fail("PRIVY_APP_ID", "required when PRIVY_APP_SECRET is set");
    if (!cfg.PRIVY_APP_SECRET) fail("PRIVY_APP_SECRET", "required when PRIVY_APP_ID is set");
    if (!cfg.PRIVY_WEBHOOK_SECRET) {
      fail("PRIVY_WEBHOOK_SECRET",
        "required in production when Privy is configured — SVIX signing secret (whsec_…) from the Privy dashboard");
    }
  }
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
      ["REDIS_URL", validatedEnv.REDIS_URL, "Rate limiting & queues disabled"],
      ["KMS_MASTER_KEY", validatedEnv.KMS_MASTER_KEY, "Encryption disabled"],
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
  get enableRedis() { return !!process.env.REDIS_URL; },
  get enableEncryption() { return !!process.env.KMS_MASTER_KEY; },
  get enableAi() { return !!process.env.SURPLUS_API_KEY; },
  enableByok: true,
  enableFlashbots: true,
  enableNotifications: true,
  enableAutomation: true,
  enableReferrals: true,
  enableHealthAlerts: true,
};
