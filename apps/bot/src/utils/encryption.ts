import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  // NOTE: Development fallback only. Production must set ENCRYPTION_KEY env var.
  const fallbackKey = 'fxbot-development-key-32-chars!!'; // DEV_FALLBACK_NOT_SECRET
  const secret = process.env.ENCRYPTION_KEY || process.env.PRIVY_APP_SECRET;
  if (!secret) {
    console.warn('WARNING: Using fallback encryption key. Set ENCRYPTION_KEY in production.');
    return Buffer.from(fallbackKey.padEnd(32, '0').slice(0, 32));
  }
  return crypto.scryptSync(secret, 'salt', KEY_LENGTH);
}

export function encrypt(text: string): string {
  if (text.length > 100000) throw new Error('Input too large');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
