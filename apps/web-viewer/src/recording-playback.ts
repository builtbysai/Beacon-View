import {
  CLIP_HEADER_BYTES,
  ChunkedClipDecryptor,
  isChunkedClip,
} from './clip-crypto';
import { Sha256 } from './sha256';

const MAX_ENCRYPTED_BYTES = 250 * 1024 * 1024;

function decodeBase64Url(
  value: string,
  length: number,
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value))
    throw new Error('Invalid recording key');
  const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  if (decoded.length !== length) throw new Error('Invalid recording key');
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++)
    bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

/** The server authorizes access (by session for a household member, by a
 * share token for an unauthenticated recipient) and relays ciphertext;
 * only this browser ever decrypts it. */
const KNOWN_MIME_TYPES = new Set([
  'video/webm',
  'video/mp4',
  'image/jpeg',
  'image/webp',
]);

async function loadEncryptedRecording(
  playbackUrl: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(playbackUrl, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: signal ?? null,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? 'Recording could not be loaded.');
  }
  const expectedBytes = Number(
    response.headers.get('X-Beacon-Recording-Bytes'),
  );
  const checksum = response.headers.get('X-Beacon-Recording-Checksum');
  const mimeType = response.headers.get('X-Beacon-Recording-Mime');
  const keyValue = response.headers.get('X-Beacon-Recording-Key');
  const ivValue = response.headers.get('X-Beacon-Recording-IV');
  if (
    !Number.isInteger(expectedBytes) ||
    expectedBytes < 17 ||
    expectedBytes > MAX_ENCRYPTED_BYTES ||
    !checksum ||
    !/^[a-f0-9]{64}$/u.test(checksum) ||
    !mimeType ||
    !KNOWN_MIME_TYPES.has(mimeType) ||
    !keyValue ||
    !ivValue
  )
    throw new Error('Recording metadata is incomplete.');

  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase64Url(keyValue, 32),
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const iv = decodeBase64Url(ivValue, 12);
  const hash = new Sha256();
  const reader = response.body?.getReader();
  if (!reader) {
    // A browser without streamed responses: read it whole (older clips are one message anyway).
    const everything = new Uint8Array(await response.arrayBuffer());
    return finishDownload(
      [everything],
      expectedBytes,
      checksum,
      mimeType,
      key,
      iv,
      hash,
      signal,
    );
  }
  // Read the download piece by piece. A chunked clip is decrypted as it arrives,
  // so memory stays near the size of the finished clip instead of several times it.
  const pieces: Uint8Array[] = [];
  let decryptor: ChunkedClipDecryptor | null = null;
  let legacy = false;
  let received = 0;
  const plaintext: Uint8Array[] = [];
  const held: Uint8Array[] = [];
  for (;;) {
    if (signal?.aborted)
      throw new DOMException('Playback cancelled', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > expectedBytes)
      throw new Error('Recording download was larger than expected.');
    hash.update(value);
    if (legacy) {
      pieces.push(value);
      continue;
    }
    if (!decryptor) {
      held.push(value);
      const heldBytes = held.reduce((sum, piece) => sum + piece.length, 0);
      if (heldBytes < CLIP_HEADER_BYTES) continue;
      const leading = joinPieces(held, heldBytes);
      held.length = 0;
      if (!isChunkedClip(leading)) {
        legacy = true;
        pieces.push(leading);
        continue;
      }
      decryptor = new ChunkedClipDecryptor(key, iv, expectedBytes);
      plaintext.push(...(await decryptor.push(leading)));
      continue;
    }
    plaintext.push(...(await decryptor.push(value)));
  }
  if (received !== expectedBytes)
    throw new Error('Recording download was incomplete.');
  if (hash.digestHex() !== checksum)
    throw new Error('Recording failed its integrity check.');
  if (decryptor) {
    decryptor.finish();
    return new Blob(plaintext as BlobPart[], { type: mimeType });
  }
  if (held.length > 0) pieces.push(...held);
  return decryptLegacy(pieces, key, iv, mimeType, signal);
}

function joinPieces(
  pieces: Uint8Array[],
  length: number,
): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.length;
  }
  return joined;
}

/** A clip recorded before the chunked format: one AES-GCM message. */
async function decryptLegacy(
  pieces: Uint8Array[],
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  mimeType: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const ciphertext = joinPieces(
    pieces,
    pieces.reduce((sum, piece) => sum + piece.length, 0),
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  if (signal?.aborted)
    throw new DOMException('Playback cancelled', 'AbortError');
  return new Blob([plaintext], { type: mimeType });
}

async function finishDownload(
  pieces: Uint8Array[],
  expectedBytes: number,
  checksum: string,
  mimeType: string,
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  hash: Sha256,
  signal?: AbortSignal,
): Promise<Blob> {
  const all = joinPieces(
    pieces,
    pieces.reduce((sum, piece) => sum + piece.length, 0),
  );
  if (all.byteLength !== expectedBytes)
    throw new Error('Recording download was incomplete.');
  if (hash.update(all).digestHex() !== checksum)
    throw new Error('Recording failed its integrity check.');
  if (isChunkedClip(all)) {
    const decryptor = new ChunkedClipDecryptor(key, iv, expectedBytes);
    const plaintext = await decryptor.push(all);
    decryptor.finish();
    return new Blob(plaintext as BlobPart[], { type: mimeType });
  }
  return decryptLegacy([all], key, iv, mimeType, signal);
}

export async function loadRecordingForPlayback(
  recordingId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return loadEncryptedRecording(
    `/api/recordings/${encodeURIComponent(recordingId)}/playback`,
    signal,
  );
}

export async function loadSharedRecordingForPlayback(
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return loadEncryptedRecording(
    `/api/shared-recordings/${encodeURIComponent(token)}/playback`,
    signal,
  );
}

export function extensionForRecordingMime(mimeType: string): string {
  return mimeType === 'video/mp4' ? 'mp4' : 'webm';
}

export async function loadRecordingThumbnail(
  recordingId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return loadEncryptedRecording(
    `/api/recordings/${encodeURIComponent(recordingId)}/thumbnail`,
    signal,
  );
}
