import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { RecordingKeyCipher } from './recording-crypto.js';

describe('RecordingKeyCipher', () => {
  it('restores a wrapped clip key and rejects tampering', () => {
    const cipher = new RecordingKeyCipher(
      randomBytes(32).toString('base64url'),
    );
    const dataKey = randomBytes(32);
    const wrapped = cipher.wrap(dataKey);
    expect(cipher.unwrap(wrapped)).toEqual(dataKey);
    const tampered = Buffer.from(wrapped.ciphertext);
    tampered[0] = tampered[0]! ^ 1;
    expect(() => cipher.unwrap({ ...wrapped, ciphertext: tampered })).toThrow();
  });
});
