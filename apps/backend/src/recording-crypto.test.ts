import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { RecordingKeyCipher, recordingKeyContext } from './recording-crypto.js';

const newKey = () => randomBytes(32).toString('base64url');

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

  it('binds a wrapped key to its recording and to clip or thumbnail (V7)', () => {
    const cipher = new RecordingKeyCipher(newKey());
    const dataKey = randomBytes(32);
    const context = recordingKeyContext('recording-1', 'clip');
    const wrapped = cipher.wrap(dataKey, context);
    expect(cipher.unwrap(wrapped, context)).toEqual(dataKey);
    // Copied to another recording, or used as the thumbnail key: refused.
    expect(() =>
      cipher.unwrap(wrapped, recordingKeyContext('recording-2', 'clip')),
    ).toThrow();
    expect(() =>
      cipher.unwrap(wrapped, recordingKeyContext('recording-1', 'thumbnail')),
    ).toThrow();
    expect(cipher.unwrapDetailed(wrapped, context).current).toBe(true);
  });

  it('still opens a key wrapped before the binding existed, and reports it as not current', () => {
    const cipher = new RecordingKeyCipher(newKey());
    const dataKey = randomBytes(32);
    const legacy = cipher.wrap(dataKey);
    const opened = cipher.unwrapDetailed(
      legacy,
      recordingKeyContext('recording-1', 'clip'),
    );
    expect(opened.dataKey).toEqual(dataKey);
    expect(opened.current).toBe(false);
  });

  it('opens keys wrapped with a previous server key so the main key can rotate', () => {
    const oldKey = newKey();
    const dataKey = randomBytes(32);
    const context = recordingKeyContext('recording-1', 'clip');
    const wrappedByOld = new RecordingKeyCipher(oldKey).wrap(dataKey, context);
    const rotated = new RecordingKeyCipher(newKey(), [oldKey]);
    const opened = rotated.unwrapDetailed(wrappedByOld, context);
    expect(opened.dataKey).toEqual(dataKey);
    expect(opened.current).toBe(false);
    // Without the old key listed, the row is unreadable.
    expect(() =>
      new RecordingKeyCipher(newKey()).unwrap(wrappedByOld, context),
    ).toThrow();
  });
});
