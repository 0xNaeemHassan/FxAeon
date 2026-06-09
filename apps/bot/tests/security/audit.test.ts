import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, hash } from '../../src/utils/encryption';

describe('Security', () => {
  it('should encrypt and decrypt data', () => {
    const original = 'sensitive-data-123';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('should generate consistent hashes', () => {
    const data = 'test-data';
    const hash1 = hash(data);
    const hash2 = hash(data);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it('should reject invalid encrypted data', () => {
    expect(() => decrypt('invalid:data')).toThrow();
  });
});
