import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/middleware/config';

const CORE = {
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  DATABASE_URL: 'postgresql://localhost:5432/test',
};

const PROD_SECURITY = {
  TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(64),
  ENCRYPTION_KEY: 'b'.repeat(64),
  INTENT_SECRET: 'c'.repeat(64),
  WEBHOOK_URL: 'https://bot.example.com',
  MINI_APP_URL: 'https://app.example.com',
};

const PROD_RUNTIME = {
  ...PROD_SECURITY,
  ALCHEMY_RPC_URL: 'https://eth.example.test',
  PRIVY_APP_ID: 'app123',
  PRIVY_APP_SECRET: 'secret',
  PRIVY_AUTHORIZATION_KEY: 'authorization-key',
};

describe('config fail-fast (W-05)', () => {
  it('accepts a minimal development config', () => {
    const r = envSchema.safeParse({ ...CORE, NODE_ENV: 'development' });
    expect(r.success).toBe(true);
  });

  it('rejects production without webhook/encryption secrets', () => {
    const r = envSchema.safeParse({ ...CORE, NODE_ENV: 'production' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('TELEGRAM_WEBHOOK_SECRET');
      expect(paths).toContain('ENCRYPTION_KEY');
      expect(paths).toContain('INTENT_SECRET');
      expect(paths).toContain('WEBHOOK_URL');
      expect(paths).toContain('MINI_APP_URL');
    }
  });

  it('accepts production with all security and money-path dependencies set', () => {
    const r = envSchema.safeParse({ ...CORE, ...PROD_RUNTIME, NODE_ENV: 'production' });
    expect(r.success).toBe(true);
  });

  it('rejects partial Privy config in production', () => {
    const r = envSchema.safeParse({
      ...CORE, ...PROD_SECURITY, NODE_ENV: 'production',
      PRIVY_APP_ID: 'app123',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('PRIVY_APP_SECRET');
      // PRIVY_WEBHOOK_SECRET no longer required (W-12): tx webhooks are a
      // Privy enterprise feature; lifecycle comes from the W-11 receipt watcher.
      expect(paths).not.toContain('PRIVY_WEBHOOK_SECRET');
    }
  });

  it('requires the full Privy signing quorum and Ethereum RPC in production', () => {
    const r = envSchema.safeParse({
      ...CORE, ...PROD_RUNTIME, NODE_ENV: 'production',
    });
    expect(r.success).toBe(true);

    for (const missing of [
      'PRIVY_APP_ID',
      'PRIVY_APP_SECRET',
      'PRIVY_AUTHORIZATION_KEY',
      'ALCHEMY_RPC_URL',
    ] as const) {
      const candidate = { ...CORE, ...PROD_RUNTIME, NODE_ENV: 'production' } as Record<string, string>;
      delete candidate[missing];
      const invalid = envSchema.safeParse(candidate);
      expect(invalid.success, missing).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues.map((i) => i.path.join('.'))).toContain(missing);
      }
    }
  });

  it('requires both source-chain RPCs when bridge execution is enabled', () => {
    const missing = envSchema.safeParse({
      ...CORE,
      NODE_ENV: 'development',
      BRIDGE_EXECUTION_ENABLED: 'true',
      ALCHEMY_RPC_URL: 'https://eth.example.test',
    });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.map((i) => i.path.join('.'))).toContain('BASE_RPC_URL');
    }

    const complete = envSchema.safeParse({
      ...CORE,
      NODE_ENV: 'development',
      BRIDGE_EXECUTION_ENABLED: 'true',
      ALCHEMY_RPC_URL: 'https://eth.example.test',
      BASE_RPC_URL: 'https://base.example.test',
    });
    expect(complete.success).toBe(true);
  });

  it('rejects misspelled bridge gate values instead of silently disabling it', () => {
    const r = envSchema.safeParse({
      ...CORE,
      NODE_ENV: 'development',
      BRIDGE_EXECUTION_ENABLED: 'yes',
    });
    expect(r.success).toBe(false);
  });

  it('refuses observe/off signer policy in production', () => {
    for (const mode of ['observe', 'off'] as const) {
      const r = envSchema.safeParse({
        ...CORE,
        ...PROD_RUNTIME,
        NODE_ENV: 'production',
        SIGNER_POLICY_MODE: mode,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.map((i) => i.path.join('.'))).toContain('SIGNER_POLICY_MODE');
      }
    }
  });

  it('rejects a short TELEGRAM_WEBHOOK_SECRET', () => {
    const r = envSchema.safeParse({
      ...CORE, ...PROD_RUNTIME, NODE_ENV: 'production',
      TELEGRAM_WEBHOOK_SECRET: 'short',
    });
    expect(r.success).toBe(false);
  });

  it('rejects webhook secrets Telegram cannot accept', () => {
    const r = envSchema.safeParse({
      ...CORE, ...PROD_RUNTIME, NODE_ENV: 'production',
      TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(31) + ':',
    });
    expect(r.success).toBe(false);
  });

  it('requires HTTPS origins in production and a strong configured admin token', () => {
    const insecure = envSchema.safeParse({
      ...CORE, ...PROD_SECURITY, NODE_ENV: 'production',
      WEBHOOK_URL: 'http://bot.example.com',
      MINI_APP_URL: 'http://app.example.com',
      ADMIN_TOKEN: 'short',
    });
    expect(insecure.success).toBe(false);
    if (!insecure.success) {
      const paths = insecure.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('WEBHOOK_URL');
      expect(paths).toContain('MINI_APP_URL');
      expect(paths).toContain('ADMIN_TOKEN');
    }
  });

  it('rejects webhook and Mini App URLs that are not pure public origins', () => {
    for (const [key, value] of [
      ['WEBHOOK_URL', 'https://bot.example.com/webhook'],
      ['WEBHOOK_URL', 'https://user:pass@bot.example.com'],
      ['MINI_APP_URL', 'https://app.example.com/trade'],
      ['MINI_APP_URL', 'https://app.example.com?preview=1'],
    ] as const) {
      const r = envSchema.safeParse({
        ...CORE,
        ...PROD_RUNTIME,
        NODE_ENV: 'production',
        [key]: value,
      });
      expect(r.success, `${key}=${value}`).toBe(false);
    }
  });
});
