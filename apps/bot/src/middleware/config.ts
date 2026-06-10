import { z } from "zod";
import { logger } from "./logger";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  PRIVY_AUTHORIZATION_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ALCHEMY_RPC_URL: z.string().url(),
  KMS_MASTER_KEY: z.string().length(64),
  SURPLUS_API_KEY: z.string().optional(),
  MINI_APP_URL: z.string().url().default("https://fxbot-mini-app.pages.dev"),
  DAILY_TX_CAP: z.string().default("50"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  PORT: z.string().default("8080"),
});

export type Env = z.infer<typeof envSchema>;
let validatedEnv: Env | null = null;

export function validateConfig(): Env {
  if (validatedEnv) return validatedEnv;
  try {
    validatedEnv = envSchema.parse(process.env);
    logger.info({ nodeEnv: validatedEnv.NODE_ENV, logLevel: validatedEnv.LOG_LEVEL }, "Configuration validated");
    return validatedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      logger.fatal({ issues }, "Configuration validation failed");
      throw new Error(`Invalid configuration:
${issues.join("
")}`);
    }
    throw error;
  }
}

export function getConfig(): Env {
  if (!validatedEnv) return validateConfig();
  return validatedEnv;
}

export const features = {
  enableAi: !!process.env.SURPLUS_API_KEY,
  enableByok: true,
  enableFlashbots: true,
  enableNotifications: true,
  enableAutomation: true,
  enableReferrals: true,
  enableHealthAlerts: true,
};
