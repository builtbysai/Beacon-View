import { isAndroidApp, saveBlobToAndroid } from './android-shell';

/** Saves a Blob already decrypted in this tab to the user's device --
 * nothing is uploaded or sent anywhere else. */
export function downloadBlob(blob: Blob, filename: string): void {
  // A WebView cannot download a blob; the Android app saves it to Downloads instead (ADR 0121).
  if (isAndroidApp()) {
    void saveBlobToAndroid(blob, filename).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
