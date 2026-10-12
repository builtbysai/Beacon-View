// Short-clip capture and encrypted direct-to-Drive upload, shared by the live
// viewer (capturing the received WebRTC stream) and browser camera mode
// (capturing its own local getUserMedia stream). Beacon never sees the media
// itself: the browser encrypts locally and PUTs ciphertext to the Google Drive
// resumable-upload session; only ciphertext metadata reaches the server.
import { base64url } from './clip-crypto';

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

export interface EncryptedClip {
  blob: Blob;
  dataKey: string;
  iv: string;
}

/** Encrypts a small asset (a thumbnail) as one AES-GCM message. Clips use the
 * chunked format in clip-crypto.ts instead (ADR 0115). */
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

/** Grabs a single frame from the stream about to be (or being) recorded, as
 * a small JPEG -- the source thumbnail image, before it's encrypted the
 * same way as the clip itself (see ADR 0078). Uses a temporary, never-
 * attached <video> element rather than the visible one, so it works
 * regardless of which visible player (live view or camera-mode preview) is
 * driving the recording, and never disturbs it. Best-effort: any failure
 * (unsupported browser, a track that never produces a frame in time)
 * rejects and the caller simply skips the thumbnail. */
export async function captureFrameAsJpeg(stream: MediaStream): Promise<Blob> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Timed out waiting for a video frame')),
        4_000,
      );
      video.addEventListener(
        'loadeddata',
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout);
          reject(new Error('Could not read the camera stream'));
        },
        { once: true },
      );
      void video.play().catch(() => undefined);
    });
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('Camera stream has no frame yet');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.75),
    );
    if (!blob) throw new Error('Could not encode the thumbnail');
    return blob;
  } finally {
    video.pause();
    video.srcObject = null;
  }
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
