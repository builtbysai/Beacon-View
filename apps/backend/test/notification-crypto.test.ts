import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { NotificationCipher } from '../src/notification-crypto.js';

const key = () => randomBytes(32).toString('base64url');

describe('notification provider encryption', () => {
  it('round trips provider material without storing plaintext and uses randomized envelopes', () => {
    const cipher = new NotificationCipher(key(), key());
    const provider = 'sensitive-provider-token-value';
    const first = cipher.encrypt(provider);
    const second = cipher.encrypt(provider);

    expect(first.providerCiphertext.toString('utf8')).not.toContain(provider);
    expect(first.wrappedKey.toString('utf8')).not.toContain(provider);
    expect(first.providerCiphertext).not.toEqual(second.providerCiphertext);
    expect(first.providerFingerprint).toBe(second.providerFingerprint);
    expect(cipher.decrypt(first)).toBe(provider);
  });

  it('fails closed when encrypted provider material is modified', () => {
    const cipher = new NotificationCipher(key(), key());
    const encrypted = cipher.encrypt('provider-token');
    encrypted.providerCiphertext[0] = encrypted.providerCiphertext[0]! ^ 1;
    expect(() => cipher.decrypt(encrypted)).toThrow();
  });

  it('rejects incorrectly sized server keys', () => {
    expect(() => new NotificationCipher('short', key())).toThrow(
      'Notification keys must each be 32-byte base64url values',
    );
  });
});
