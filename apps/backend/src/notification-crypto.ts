import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

export interface EncryptedProviderMaterial {
  providerCiphertext: Buffer;
  providerIv: Buffer;
  wrappedKey: Buffer;
  wrappedKeyIv: Buffer;
  providerFingerprint: string;
  keyVersion: number;
}

function seal(
  key: Buffer,
  plaintext: Buffer,
): { ciphertext: Buffer; iv: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, iv };
}

function open(key: Buffer, iv: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < 17)
    throw new Error('Invalid encrypted notification material');
  const tag = sealed.subarray(sealed.length - 16);
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export class NotificationCipher {
  readonly #encryptionKey: Buffer;
  readonly #fingerprintKey: Buffer;

  constructor(encryptionKey: string, fingerprintKey: string) {
    this.#encryptionKey = Buffer.from(encryptionKey, 'base64url');
    this.#fingerprintKey = Buffer.from(fingerprintKey, 'base64url');
    if (
      this.#encryptionKey.length !== 32 ||
      this.#fingerprintKey.length !== 32
    ) {
      throw new Error(
        'Notification keys must each be 32-byte base64url values',
      );
    }
  }

  encrypt(providerMaterial: string): EncryptedProviderMaterial {
    const dataKey = randomBytes(32);
    const provider = seal(dataKey, Buffer.from(providerMaterial, 'utf8'));
    const wrapped = seal(this.#encryptionKey, dataKey);
    return {
      keyVersion: 1,
      providerCiphertext: provider.ciphertext,
      providerFingerprint: createHmac('sha256', this.#fingerprintKey)
        .update(providerMaterial)
        .digest('base64url'),
      providerIv: provider.iv,
      wrappedKey: wrapped.ciphertext,
      wrappedKeyIv: wrapped.iv,
    };
  }

  decrypt(
    material: Omit<EncryptedProviderMaterial, 'providerFingerprint'>,
  ): string {
    if (material.keyVersion !== 1)
      throw new Error('Unsupported notification key version');
    const dataKey = open(
      this.#encryptionKey,
      material.wrappedKeyIv,
      material.wrappedKey,
    );
    return open(
      dataKey,
      material.providerIv,
      material.providerCiphertext,
    ).toString('utf8');
  }
}
