import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, hash } from '../../src/utils/encryption';

describe('Security — at-rest encryption (v2)', () => {
  it('round-trips plaintext', () => {
    const original = 'sensitive-data-123';
    expect(decrypt(encrypt(original))).toBe(original);
  });

  it('uses the v2 format with a fresh salt and IV per ciphertext', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a.startsWith('v2:')).toBe(true);
    expect(a).not.toBe(b); // random salt + IV → different ciphertexts
    const [, saltA] = a.split(':');
    const [, saltB] = b.split(':');
    expect(saltA).not.toBe(saltB);
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const enc = encrypt('integrity-check');
    const parts = enc.split(':');
    const cipher = parts[4];
    const flipped = (parseInt(cipher.slice(0, 1), 16) ^ 1).toString(16) + cipher.slice(1);
    parts[4] = flipped;
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('rejects legacy 3-part ciphertexts with a descriptive error', () => {
    expect(() => decrypt('aa:bb:cc')).toThrow(/legacy/i);
  });

  it('rejects malformed input', () => {
    expect(() => decrypt('invalid:data')).toThrow();
    expect(() => decrypt('v2:zz:zz:zz:zz')).toThrow();
    expect(() => decrypt('')).toThrow();
  });

  it('generates consistent hashes', () => {
    const h1 = hash('test-data');
    const h2 = hash('test-data');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
