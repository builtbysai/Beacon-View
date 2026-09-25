import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface WrappedRecordingKey {
  ciphertext: Buffer;
  iv: Buffer;
}

/** Protects a browser-generated clip key before it is persisted as metadata. */
export class RecordingKeyCipher {
  readonly #key: Buffer;

  constructor(key: string) {
    this.#key = Buffer.from(key, 'base64url');
    if (this.#key.length !== 32)
      throw new Error(
        'Recording encryption key must be a 32-byte base64url value',
      );
  }

  wrap(dataKey: Buffer): WrappedRecordingKey {
    if (dataKey.length !== 32)
      throw new Error('Recording data key must be 32 bytes');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    return {
      ciphertext: Buffer.concat([
        cipher.update(dataKey),
        cipher.final(),
        cipher.getAuthTag(),
      ]),
      iv,
    };
  }

  unwrap(wrapped: WrappedRecordingKey): Buffer {
    if (wrapped.iv.length !== 12 || wrapped.ciphertext.length !== 48)
      throw new Error('Invalid recording key envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, wrapped.iv);
    decipher.setAuthTag(wrapped.ciphertext.subarray(32));
    return Buffer.concat([
      decipher.update(wrapped.ciphertext.subarray(0, 32)),
      decipher.final(),
    ]);
  }
}
