/**
 * Least-privilege web permissions for the Beacon window. Camera and
 * microphone serve Camera Mode and Talk; clipboard write serves "copy link";
 * fullscreen serves the live player. Everything else -- notifications,
 * geolocation, screen capture, HID/USB/serial, MIDI -- is denied, and
 * nothing is granted to any origin but Beacon's own.
 */
const GRANTED = new Set(['clipboard-sanitized-write', 'fullscreen', 'media']);
const MEDIA_TYPES = new Set(['audio', 'video']);

export function isPermissionGranted(
  permission: string,
  requestingUrl: string,
  appOrigin: string,
  mediaTypes: readonly string[] = [],
): boolean {
  let origin: string;
  try {
    origin = new URL(requestingUrl).origin;
  } catch {
    return false;
  }
  if (origin !== appOrigin || !GRANTED.has(permission)) return false;
  return mediaTypes.every((type) => MEDIA_TYPES.has(type));
}
