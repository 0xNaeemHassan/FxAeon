import { z } from 'zod';

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  ETH_RPC_URL: z.string().url(),
  SENTRY_DSN: z.string().optional(),
  RATE_LIMIT_MAX: z.string().default('30'),
  RATE_LIMIT_WINDOW: z.string().default('60000'),
  ALLOWED_ORIGINS: z.string().default('https://t.me'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const config = envSchema.parse(process.env);

export const SECURITY_CONFIG = {
  rateLimit: {
    windowMs: parseInt(config.RATE_LIMIT_WINDOW, 10),
    maxRequests: parseInt(config.RATE_LIMIT_MAX, 10),
  },
  cors: {
    origin: config.ALLOWED_ORIGINS.split(','),
    methods: ['GET', 'POST'] as const,
  },
  headers: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  },
} as const;

export const FX_CONFIG = {
  maxLeverageXETH: 31,
  maxLeverageXUSD: 10,
  liquidationThreshold: 80,
  cooldownPeriodMinutes: 60,
  defaultSlippageBps: 50,
  maxSlippageBps: 500,
  minPositionSize: 0.01,
  maxPositionSize: 1000,
  defaultGasLimit: 500000,
  maxGasLimit: 2000000,
} as const;
