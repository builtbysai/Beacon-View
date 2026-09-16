// Short-clip capture and direct-to-Drive upload, shared by the live viewer
// (capturing the received WebRTC stream) and browser camera mode (capturing
// its own local getUserMedia stream). Beacon never sees the media itself --
// the browser records locally and PUTs straight to the Google Drive
// resumable-upload session the backend hands back; only metadata (size,
// duration, checksum, the resulting Drive file id) ever reaches the server.

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
    CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ??
    null
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
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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
  if (!response.ok) throw new Error('Upload to Google Drive failed');
  const file = (await response.json()) as { id?: string };
  if (!file.id) throw new Error('Google Drive did not return a file id');
  return file.id;
}
