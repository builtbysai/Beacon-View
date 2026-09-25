// Short-clip capture and encrypted direct-to-Drive upload, shared by the live
// viewer (capturing the received WebRTC stream) and browser camera mode
// (capturing its own local getUserMedia stream). Beacon never sees the media
// itself: the browser encrypts locally and PUTs ciphertext to the Google Drive
// resumable-upload session; only ciphertext metadata reaches the server.

/** Well under the backend's 10-minute cap -- a manual clip auto-stops here
 * so a forgotten recording doesn't run indefinitely. */
export const MAX_CLIP_DURATION_MS = 3 * 60 * 1_000;

const CANDIDATE_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const;

/** The exact string to construct a MediaRecorder with, or null when this
 * browser can't record video at all. */
export function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return (
    CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
  );
}

/** Beacon's API only cares about the container, not the codec. */
export function recordingContainerType(
  recorderMimeType: string,
): 'video/mp4' | 'video/webm' {
  return recorderMimeType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
}

export function formatClipTimer(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export interface EncryptedClip {
  blob: Blob;
  dataKey: string;
  iv: string;
}

/** Encrypts the completed media locally before the direct Drive upload. */
export async function encryptClip(blob: Blob): Promise<EncryptedClip> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // A typed view is accepted by WebCrypto in browsers and avoids a cross-realm
  // ArrayBuffer rejection when JSDOM's Blob is paired with Node WebCrypto.
  const plaintext = new Uint8Array(await blob.arrayBuffer());
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );
  return {
    blob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    dataKey: base64url(
      new Uint8Array(await crypto.subtle.exportKey('raw', key)),
    ),
    iv: base64url(iv),
  };
}

export class ClipRecorder {
  #recorder: MediaRecorder;
  #chunks: BlobPart[] = [];
  #startedAt = 0;

  constructor(stream: MediaStream, mimeType: string) {
    this.#recorder = new MediaRecorder(stream, { mimeType });
    this.#recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
  }

  get mimeType(): string {
    return this.#recorder.mimeType;
  }

  start(): void {
    this.#startedAt = Date.now();
    this.#recorder.start();
  }

  /** Resolves once the final chunk has actually been flushed -- stopping a
   * MediaRecorder is asynchronous, so reading `#chunks` before its `stop`
   * event fires would silently drop the tail of the clip. */
  stop(): Promise<{ blob: Blob; durationMs: number }> {
    const durationMs = Date.now() - this.#startedAt;
    return new Promise((resolve, reject) => {
      this.#recorder.addEventListener(
        'stop',
        () => {
          resolve({
            blob: new Blob(this.#chunks, { type: this.#recorder.mimeType }),
            durationMs,
          });
        },
        { once: true },
      );
      this.#recorder.addEventListener(
        'error',
        (event) =>
          reject(
            (event as unknown as { error?: Error }).error ??
              new Error('Recording failed'),
          ),
        { once: true },
      );
      this.#recorder.stop();
    });
  }

  /** For an unmount or a cancelled recording -- no upload should happen. */
  discard(): void {
    if (this.#recorder.state !== 'inactive') this.#recorder.stop();
  }
}

/** PUTs the whole clip in one request to the resumable session Beacon
 * already opened with Drive, then returns the id Drive assigned the file so
 * the caller can tell Beacon what to verify. A short clip comfortably fits
 * in a single request; Drive's resumable protocol accepts that as long as
 * the byte count matches what the session was opened for. */
export async function uploadClipToDrive(
  uploadUrl: string,
  blob: Blob,
): Promise<string> {
  const response = await fetch(uploadUrl, {
    body: blob,
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    method: 'PUT',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { errors?: Array<{ reason?: string }> };
    } | null;
    const reason = payload?.error?.errors?.[0]?.reason ?? '';
    const kind =
      response.status === 404 || response.status === 410
        ? 'session_expired'
        : reason === 'storageQuotaExceeded' || reason === 'quotaExceeded'
          ? 'quota'
          : response.status === 401 || response.status === 403
            ? 'authorization'
            : response.status === 429 || response.status >= 500
              ? 'temporary'
              : 'unknown';
    throw new DriveUploadError(kind, response.status);
  }
  const file = (await response.json()) as { id?: string };
  if (!file.id) throw new Error('Google Drive did not return a file id');
  return file.id;
}

export class DriveUploadError extends Error {
  constructor(
    readonly kind:
      'authorization' | 'quota' | 'session_expired' | 'temporary' | 'unknown',
    readonly status: number,
  ) {
    super(
      kind === 'quota'
        ? 'Google Drive is out of storage. Free some space, then retry this upload.'
        : kind === 'authorization'
          ? 'Google Drive access expired. Reconnect Drive in Settings, then retry this upload.'
          : kind === 'session_expired'
            ? 'The Google Drive upload session expired. Retry this upload.'
            : kind === 'temporary'
              ? 'Google Drive is temporarily unavailable. Retry this upload.'
              : 'Google Drive rejected the upload. Check Drive, then retry.',
    );
    this.name = 'DriveUploadError';
  }
}
