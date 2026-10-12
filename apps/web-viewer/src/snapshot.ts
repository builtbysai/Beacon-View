import { isAndroidApp, saveBlobToAndroid } from './android-shell';
/**
 * Snapshot of a live view (ADR 0090). The picture is drawn from the video the
 * person is already watching and saved as a file on their own device.
 * Nothing is uploaded and nothing is stored by Beacon.
 */

/** `Beacon-Porch-2026-10-08-12-30-05.png`, safe on every file system. */
export function snapshotFileName(cameraName: string, now: Date): string {
  const name =
    cameraName
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40) || 'Camera';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('-');
  return `Beacon-${name}-${stamp}.png`;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The video's current frame as a PNG. */
export function captureSnapshot(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height)
    return Promise.reject(
      new SnapshotError('The video has no picture yet. Try again in a moment.'),
    );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context)
    return Promise.reject(
      new SnapshotError('This browser can’t take a snapshot.'),
    );
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new SnapshotError('The snapshot couldn’t be created.')),
      'image/png',
    );
  });
}

/** Saves a blob through the browser's normal download. */
export function saveBlob(blob: Blob, fileName: string): void {
  // A WebView cannot download a blob; the Android app saves it to Downloads instead (ADR 0121).
  if (isAndroidApp()) {
    void saveBlobToAndroid(blob, fileName).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
