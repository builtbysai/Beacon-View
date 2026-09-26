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

  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (ciphertext.byteLength !== expectedBytes)
    throw new Error('Recording download was incomplete.');
  const digest = await crypto.subtle.digest('SHA-256', ciphertext);
  const actualChecksum = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actualChecksum !== checksum)
    throw new Error('Recording failed its integrity check.');

  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase64Url(keyValue, 32),
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64Url(ivValue, 12) },
    key,
    ciphertext,
  );
  if (signal?.aborted)
    throw new DOMException('Playback cancelled', 'AbortError');
  return new Blob([plaintext], { type: mimeType });
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
