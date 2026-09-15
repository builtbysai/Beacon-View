import { describe, expect, it } from 'vitest';

import { GoogleDriveTokenCipher } from '../src/google-drive-crypto.js';

const key = Buffer.alloc(32, 7).toString('base64url');

describe('GoogleDriveTokenCipher', () => {
  it('round-trips refresh tokens and uses a fresh IV', () => {
    const cipher = new GoogleDriveTokenCipher(key);
    const first = cipher.encrypt('refresh-token-value');
    const second = cipher.encrypt('refresh-token-value');

    expect(cipher.decrypt(first.ciphertext, first.iv)).toBe(
      'refresh-token-value',
    );
    expect(second.iv).not.toEqual(first.iv);
    expect(second.ciphertext).not.toEqual(first.ciphertext);
  });

  it('rejects tampered ciphertext', () => {
    const cipher = new GoogleDriveTokenCipher(key);
    const encrypted = cipher.encrypt('refresh-token-value');
    encrypted.ciphertext[0]! ^= 1;

    expect(() => cipher.decrypt(encrypted.ciphertext, encrypted.iv)).toThrow();
  });
});
