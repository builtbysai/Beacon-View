// The chunked clip format (ADR 0115, "BCLIP1"). A clip is encrypted in fixed
// 1 MiB pieces so neither recording nor playback ever holds a whole clip as one
// buffer, and so a truncated or rearranged file is rejected.
//
//   file   = header (16 bytes) || chunk 0 || chunk 1 || ... || last chunk
//   header = "BCLIP1" || 0x00 0x00 || chunk size (uint32, big endian) || 4 zero bytes
//   chunk  = AES-256-GCM(plaintext piece) || 16-byte tag
//   nonce  = first 7 bytes of the clip IV || chunk index (uint32, big endian) || last-chunk flag (0 or 1)
//   AAD    = the 16 header bytes
//
// Every chunk holds exactly the chunk size of plaintext except the last, which
// holds 1 to chunk-size bytes (or none, for an empty clip) and is the only one
// sealed with the flag set. Clips recorded before this format are one AES-GCM
// message with no header; readers tell the two apart by the magic bytes.
import { Sha256 } from './sha256';

export const CLIP_HEADER_BYTES = 16;
const CLIP_CHUNK_BYTES = 1024 * 1024;
const TAG_BYTES = 16;
const MIN_CHUNK_BYTES = 4096;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAGIC = [0x42, 0x43, 0x4c, 0x49, 0x50, 0x31]; // "BCLIP1"

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function clipHeader(chunkBytes: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(CLIP_HEADER_BYTES);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(8, chunkBytes);
  return header;
}

/** True when these leading bytes begin a chunked clip. */
export function isChunkedClip(leading: Uint8Array): boolean {
  return (
    leading.length >= MAGIC.length && MAGIC.every((b, i) => leading[i] === b)
  );
}

function chunkNonce(
  ivPrefix: Uint8Array,
  index: number,
  last: boolean,
): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(12);
  nonce.set(ivPrefix.subarray(0, 7), 0);
  new DataView(nonce.buffer).setUint32(7, index);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

interface ChunkedClip {
  blob: Blob;
  dataKey: string;
  iv: string;
  /** SHA-256 of the whole encrypted file, hex. */
  sha256: string;
}

/** Encrypts `source` piece by piece. `fixed` pins the key and IV for tests. */
export async function encryptClipChunked(
  source: Blob,
  fixed?: { chunkBytes?: number; iv?: Uint8Array; key?: Uint8Array },
): Promise<ChunkedClip> {
  const chunkBytes = fixed?.chunkBytes ?? CLIP_CHUNK_BYTES;
  const keyBytes =
    (fixed?.key as Uint8Array<ArrayBuffer> | undefined) ??
    crypto.getRandomValues(new Uint8Array(32));
  const iv =
    (fixed?.iv as Uint8Array<ArrayBuffer> | undefined) ??
    crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'encrypt',
  ]);
  const header = clipHeader(chunkBytes);
  const hash = new Sha256().update(header);
  const parts: BlobPart[] = [header];
  const total = source.size;
  const chunkCount = Math.max(1, Math.ceil(total / chunkBytes));
  for (let index = 0; index < chunkCount; index++) {
    const piece = new Uint8Array(
      await source
        .slice(index * chunkBytes, (index + 1) * chunkBytes)
        .arrayBuffer(),
    );
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: header,
          iv: chunkNonce(iv, index, index === chunkCount - 1),
          name: 'AES-GCM',
        },
        key,
        piece,
      ),
    );
    hash.update(sealed);
    parts.push(sealed);
  }
  return {
    blob: new Blob(parts, { type: 'application/octet-stream' }),
    dataKey: base64url(keyBytes),
    iv: base64url(iv),
    sha256: hash.digestHex(),
  };
}

/** Decrypts a chunked clip as its bytes arrive, in pieces of any size. */
export class ChunkedClipDecryptor {
  #key: CryptoKey;
  #ivPrefix: Uint8Array;
  #total: number;
  #header: Uint8Array<ArrayBuffer> | null = null;
  #chunkBytes = 0;
  #chunkCount = 0;
  #finalCipherBytes = 0;
  #index = 0;
  #received = 0;
  #pending: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  constructor(key: CryptoKey, ivPrefix: Uint8Array, totalBytes: number) {
    this.#key = key;
    this.#ivPrefix = ivPrefix;
    this.#total = totalBytes;
  }

  /** Feeds more ciphertext; returns the plaintext of every chunk it completed. */
  async push(bytes: Uint8Array): Promise<Uint8Array[]> {
    this.#received += bytes.length;
    if (this.#received > this.#total)
      throw new Error('Recording download was larger than expected.');
    if (this.#pending.length === 0) {
      this.#pending = bytes.slice();
    } else {
      const merged = new Uint8Array(this.#pending.length + bytes.length);
      merged.set(this.#pending, 0);
      merged.set(bytes, this.#pending.length);
      this.#pending = merged;
    }
    const output: Uint8Array[] = [];
    if (!this.#header) {
      if (this.#pending.length < CLIP_HEADER_BYTES) return output;
      this.#readHeader();
    }
    for (;;) {
      if (this.#index >= this.#chunkCount) break;
      const last = this.#index === this.#chunkCount - 1;
      const need = last ? this.#finalCipherBytes : this.#chunkBytes + TAG_BYTES;
      if (this.#pending.length < need) break;
      output.push(await this.#open(this.#pending.subarray(0, need), last));
      this.#pending = this.#pending.slice(need);
      this.#index++;
    }
    return output;
  }

  /** Confirms the whole file arrived and every chunk was opened. */
  finish(): void {
    if (
      !this.#header ||
      this.#received !== this.#total ||
      this.#index !== this.#chunkCount ||
      this.#pending.length !== 0
    )
      throw new Error('Recording download was incomplete.');
  }

  #readHeader(): void {
    const header = this.#pending.slice(0, CLIP_HEADER_BYTES);
    if (!isChunkedClip(header)) throw new Error('Recording format is unknown.');
    const chunkBytes = new DataView(header.buffer).getUint32(8);
    if (
      chunkBytes < MIN_CHUNK_BYTES ||
      chunkBytes > MAX_CHUNK_BYTES ||
      (chunkBytes & (chunkBytes - 1)) !== 0 ||
      header.subarray(6, 8).some((b) => b !== 0) ||
      header.subarray(12, 16).some((b) => b !== 0)
    )
      throw new Error('Recording format is not supported.');
    const body = this.#total - CLIP_HEADER_BYTES;
    const fullCipher = chunkBytes + TAG_BYTES;
    const chunkCount = Math.max(1, Math.ceil(body / fullCipher));
    const finalCipherBytes = body - (chunkCount - 1) * fullCipher;
    if (body < TAG_BYTES || finalCipherBytes < TAG_BYTES)
      throw new Error('Recording is damaged.');
    this.#header = header;
    this.#chunkBytes = chunkBytes;
    this.#chunkCount = chunkCount;
    this.#finalCipherBytes = finalCipherBytes;
    this.#pending = this.#pending.slice(CLIP_HEADER_BYTES);
  }

  async #open(
    sealed: Uint8Array<ArrayBuffer>,
    last: boolean,
  ): Promise<Uint8Array> {
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          {
            additionalData: this.#header!,
            iv: chunkNonce(this.#ivPrefix, this.#index, last),
            name: 'AES-GCM',
          },
          this.#key,
          sealed,
        ),
      );
    } catch {
      throw new Error('Recording failed its integrity check.');
    }
  }
}
