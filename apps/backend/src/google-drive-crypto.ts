import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedDriveToken {
  ciphertext: Buffer;
  iv: Buffer;
}

export class GoogleDriveTokenCipher {
  readonly #key: Buffer;

  constructor(key: string) {
    this.#key = Buffer.from(key, 'base64url');
    if (this.#key.length !== 32)
      throw new Error('Google Drive token key must be 32 bytes');
  }

  encrypt(refreshToken: string): EncryptedDriveToken {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    return {
      ciphertext: Buffer.concat([
        cipher.update(refreshToken, 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
      ]),
      iv,
    };
  }

  decrypt(ciphertext: Buffer, iv: Buffer): string {
    if (ciphertext.length < 17) throw new Error('Invalid Drive token');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    return Buffer.concat([
      decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
      decipher.final(),
    ]).toString('utf8');
  }
}
