import crypto from 'crypto';

/**
 * At-rest encryption (AUDIT.md P0-7, PLAN.md W-06).
 *
 * Format (v2): `v2:<saltHex>:<ivHex>:<authTagHex>:<cipherHex>`
 * - AES-256-GCM
 * - Key derived per-ciphertext via scrypt(ENCRYPTION_KEY, randomSalt)
 *
 * Rules:
 * - Production REQUIRES ENCRYPTION_KEY (config.ts fails the boot without it).
 * - No hardcoded fallback key, ever.
 * - PRIVY_APP_SECRET is NOT an encryption key (removed alias).
 * - Development without ENCRYPTION_KEY gets a random per-boot key — encrypted
 *   values do not survive a restart, which is loudly logged.
 *
 * Migration note: the legacy 3-part format (static 'salt' scrypt or hardcoded
 * dev key) had ZERO production consumers at the time of this change (verified
 * by grep across apps/ and packages/), so legacy decryption is intentionally
 * not supported. decrypt() throws a descriptive error if it ever sees one.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // NIST-recommended GCM nonce size
const SALT_LENGTH = 16;
const MAX_PLAINTEXT = 100_000;
const VERSION = 'v2';

let devFallbackKey: string | null = null;

function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    // Defense in depth: config.ts already fails the boot, but never allow a
    // silent weak key even if this module is reached some other way.
    throw new Error('ENCRYPTION_KEY is required in production (openssl rand -hex 32)');
  }
  if (!devFallbackKey) {
    devFallbackKey = crypto.randomBytes(32).toString('hex');
    console.warn(
      'WARNING: ENCRYPTION_KEY not set — using a random per-boot key. ' +
        'Encrypted values will NOT survive a restart. Set ENCRYPTION_KEY for persistence.'
    );
  }
  return devFallbackKey;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

export function encrypt(text: string): string {
  if (text.length > MAX_PLAINTEXT) throw new Error('Input too large');
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(getSecret(), salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length === 3) {
    throw new Error(
      'Unsupported legacy ciphertext format (pre-v2). Legacy data was never written in production; re-encrypt the value.'
    );
  }
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Invalid ciphertext format');
  }
  const [, saltHex, ivHex, authTagHex, cipherHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || authTag.length !== 16) {
    throw new Error('Invalid ciphertext format');
  }

  const key = deriveKey(getSecret(), salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8');
}

export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
