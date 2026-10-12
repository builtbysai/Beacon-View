import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

interface WrappedRecordingKey {
  ciphertext: Buffer;
  iv: Buffer;
}

export type RecordingKeyPurpose = 'clip' | 'thumbnail';

/**
 * What a wrapped clip key is bound to (V7). The recording and which of its two
 * files the key opens go into the authenticated data of the wrap, so a key
 * copied from one row to another, or from a clip to a thumbnail, no longer
 * unwraps.
 */
export function recordingKeyContext(
  recordingId: string,
  purpose: RecordingKeyPurpose,
): Buffer {
  return Buffer.from(
    `beacon:recording-key:v1:${purpose}:${recordingId}`,
    'utf8',
  );
}

function parseKey(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32)
    throw new Error(
      'Recording encryption key must be a 32-byte base64url value',
    );
  return bytes;
}

/** Protects a browser-generated clip key before it is persisted as metadata. */
export class RecordingKeyCipher {
  readonly #key: Buffer;
  readonly #previous: Buffer[];

  /**
   * @param key the key every new wrap uses
   * @param previousKeys keys that wrapped older rows; they still unwrap, so the
   * main key can be rotated, and the rewrap job moves rows to the main key
   */
  constructor(key: string, previousKeys: string[] = []) {
    this.#key = parseKey(key);
    this.#previous = previousKeys.map(parseKey);
  }

  wrap(dataKey: Buffer, context?: Buffer): WrappedRecordingKey {
    if (dataKey.length !== 32)
      throw new Error('Recording data key must be 32 bytes');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    if (context) cipher.setAAD(context);
    return {
      ciphertext: Buffer.concat([
        cipher.update(dataKey),
        cipher.final(),
        cipher.getAuthTag(),
      ]),
      iv,
    };
  }

  /**
   * Opens a wrapped key. Rows written before the binding existed carry no
   * context, so when a context is given the bare form is accepted as well and
   * reported as not current, for the rewrap job to upgrade.
   */
  unwrapDetailed(
    wrapped: WrappedRecordingKey,
    context?: Buffer,
  ): { current: boolean; dataKey: Buffer } {
    if (wrapped.iv.length !== 12 || wrapped.ciphertext.length !== 48)
      throw new Error('Invalid recording key envelope');
    const keys = [this.#key, ...this.#previous];
    const contexts: (Buffer | undefined)[] = context
      ? [context, undefined]
      : [undefined];
    for (const [keyIndex, key] of keys.entries()) {
      for (const [contextIndex, candidate] of contexts.entries()) {
        try {
          return {
            current: keyIndex === 0 && contextIndex === 0,
            dataKey: this.#open(key, wrapped, candidate),
          };
        } catch {
          // Try the next key or the legacy form.
        }
      }
    }
    throw new Error('Recording key could not be unwrapped');
  }

  unwrap(wrapped: WrappedRecordingKey, context?: Buffer): Buffer {
    return this.unwrapDetailed(wrapped, context).dataKey;
  }

  #open(key: Buffer, wrapped: WrappedRecordingKey, context?: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', key, wrapped.iv);
    if (context) decipher.setAAD(context);
    decipher.setAuthTag(wrapped.ciphertext.subarray(32));
    return Buffer.concat([
      decipher.update(wrapped.ciphertext.subarray(0, 32)),
      decipher.final(),
    ]);
  }
}
