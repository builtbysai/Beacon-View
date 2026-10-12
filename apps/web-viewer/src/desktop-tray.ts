import { desktopBridge } from './desktop-shell';

/** How many favorites the desktop tray lists (ADR 0095). */
const TRAY_CAMERA_LIMIT = 6;
/** Home shows this many when nothing has been chosen yet. */
const DEFAULT_FAVORITE_COUNT = 4;

interface TrayCandidate {
  deviceId: string;
  id: string;
  name: string;
}

/**
 * The cameras to offer in the desktop tray: the person's favorites in their
 * order, or Home's default few when nothing has been chosen.
 */
export function trayCameras(
  hostCameras: readonly TrayCandidate[],
  favoriteDeviceIds: readonly string[] | null,
): { id: string; name: string }[] {
  const ids =
    favoriteDeviceIds ??
    hostCameras
      .slice(0, DEFAULT_FAVORITE_COUNT)
      .map((camera) => camera.deviceId);
  return ids
    .map((deviceId) =>
      hostCameras.find((camera) => camera.deviceId === deviceId),
    )
    .filter((camera): camera is TrayCandidate => Boolean(camera))
    .slice(0, TRAY_CAMERA_LIMIT)
    .map((camera) => ({ id: camera.id, name: camera.name }));
}

/** Tells the desktop app's tray which cameras to list. No-op elsewhere. */
export function reportTrayCameras(
  cameras: readonly { id: string; name: string }[],
): void {
  desktopBridge()?.setTrayCameras?.([...cameras]);
}
