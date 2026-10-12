import { describe, expect, it } from 'vitest';

import {
  ChunkedClipDecryptor,
  clipHeader,
  encryptClipChunked,
  isChunkedClip,
} from './clip-crypto';
import { Sha256 } from './sha256';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const IV = Uint8Array.from({ length: 12 }, (_, i) => 0x10 + i);
const CHUNK = 4096;

function pattern(length: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, i) => i % 251);
}

async function seal(length: number) {
  const source = new Blob([pattern(length)]);
  const sealed = await encryptClipChunked(source, {
    chunkBytes: CHUNK,
    iv: IV,
    key: KEY,
  });
  return new Uint8Array(await sealed.blob.arrayBuffer());
}

async function open(bytes: Uint8Array, pieceBytes = bytes.length || 1) {
  const key = await crypto.subtle.importKey('raw', KEY, 'AES-GCM', false, [
    'decrypt',
  ]);
  const decryptor = new ChunkedClipDecryptor(key, IV, bytes.length);
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += pieceBytes)
    parts.push(
      ...(await decryptor.push(bytes.subarray(offset, offset + pieceBytes))),
    );
  decryptor.finish();
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

describe('chunked clip format (ADR 0115)', () => {
  it('matches the known answer shared with the Android app', async () => {
    const sealed = await encryptClipChunked(new Blob([pattern(5000)]), {
      chunkBytes: CHUNK,
      iv: IV,
      key: KEY,
    });
    // Android's ClipCryptoTest asserts the same digest for the same inputs.
    expect(sealed.sha256).toBe(
      'c962c4581ddd4a3fb9a5944752c20f98cafc0a25bd9ae82728eed410c0a3c5ce',
    );
    expect(sealed.blob.size).toBe(16 + 5000 + 2 * 16);
  });

  it('round-trips every boundary size, however the bytes arrive', async () => {
    for (const length of [
      0,
      1,
      CHUNK - 1,
      CHUNK,
      CHUNK + 1,
      3 * CHUNK,
      3 * CHUNK + 7,
    ]) {
      const sealed = await seal(length);
      expect(isChunkedClip(sealed)).toBe(true);
      expect(await open(sealed)).toEqual(pattern(length));
      expect(await open(sealed, 1000)).toEqual(pattern(length));
      expect(await open(sealed, 7)).toEqual(pattern(length));
    }
  });

  it('hashes the encrypted file the same as a one-shot SHA-256', async () => {
    const sealed = await encryptClipChunked(new Blob([pattern(9000)]), {
      chunkBytes: CHUNK,
    });
    const bytes = new Uint8Array(await sealed.blob.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    expect(sealed.sha256).toBe(
      Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
    );
  });

  it('rejects a flipped byte, a truncated file and extra bytes', async () => {
    const sealed = await seal(3 * CHUNK + 5);
    const flipped = sealed.slice();
    flipped[flipped.length - 20] = flipped[flipped.length - 20]! ^ 1;
    await expect(open(flipped)).rejects.toThrow(/integrity/);

    // Dropping the last chunk leaves a file that ends cleanly on a chunk boundary.
    const cut = sealed.slice(0, 16 + 3 * (CHUNK + 16));
    await expect(open(cut)).rejects.toThrow(/integrity/);

    const longer = new Uint8Array(sealed.length + 1);
    longer.set(sealed);
    const key = await crypto.subtle.importKey('raw', KEY, 'AES-GCM', false, [
      'decrypt',
    ]);
    const decryptor = new ChunkedClipDecryptor(key, IV, sealed.length);
    await expect(decryptor.push(longer)).rejects.toThrow(/larger/);
  });

  it('rejects chunks that were swapped or a header that was changed', async () => {
    const sealed = await seal(3 * CHUNK);
    const swapped = sealed.slice();
    const first = sealed.subarray(16, 16 + CHUNK + 16);
    const second = sealed.subarray(16 + CHUNK + 16, 16 + 2 * (CHUNK + 16));
    swapped.set(second, 16);
    swapped.set(first, 16 + CHUNK + 16);
    await expect(open(swapped)).rejects.toThrow(/integrity/);

    const header = sealed.slice();
    header.set(clipHeader(CHUNK * 2), 0);
    await expect(open(header)).rejects.toThrow();
  });

  it('does not mistake an older single-message clip for the new format', () => {
    expect(isChunkedClip(crypto.getRandomValues(new Uint8Array(64)))).toBe(
      false,
    );
  });
});

describe('incremental SHA-256', () => {
  it('matches the published test vectors', () => {
    expect(new Sha256().digestHex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(
      new Sha256().update(new TextEncoder().encode('abc')).digestHex(),
    ).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(
      new Sha256()
        .update(
          new TextEncoder().encode(
            'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
          ),
        )
        .digestHex(),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('agrees with WebCrypto across lengths and piece sizes', async () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 255);
      const expected = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const hash = new Sha256();
      for (let at = 0; at < length; at += 37)
        hash.update(bytes.subarray(at, at + 37));
      expect(hash.digestHex()).toBe(expected);
    }
  });
});
