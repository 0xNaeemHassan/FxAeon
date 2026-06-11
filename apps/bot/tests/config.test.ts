import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/middleware/config';

const CORE = {
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  DATABASE_URL: 'postgresql://localhost:5432/test',
};

const PROD_SECURITY = {
  TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(64),
  ENCRYPTION_KEY: 'b'.repeat(64),
  WEBHOOK_URL: 'https://bot.example.com',
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
      expect(paths).toContain('WEBHOOK_URL');
    }
  });

  it('accepts production with all security vars set', () => {
    const r = envSchema.safeParse({ ...CORE, ...PROD_SECURITY, NODE_ENV: 'production' });
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

  it('accepts complete Privy config in production', () => {
    const r = envSchema.safeParse({
      ...CORE, ...PROD_SECURITY, NODE_ENV: 'production',
      PRIVY_APP_ID: 'app123', PRIVY_APP_SECRET: 'secret',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a short TELEGRAM_WEBHOOK_SECRET', () => {
    const r = envSchema.safeParse({
      ...CORE, ...PROD_SECURITY, NODE_ENV: 'production',
      TELEGRAM_WEBHOOK_SECRET: 'short',
    });
    expect(r.success).toBe(false);
  });
});
