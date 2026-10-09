/**
 * Favorite cameras in the tray (ADR 0095). The web app knows which cameras
 * are the person's favorites (a per-browser choice) and sends a short list
 * of IDs and names. The tray shows them as shortcuts. Everything arriving
 * over IPC is validated again here; nothing but a same-origin path is ever
 * built from it.
 */
export interface TrayCamera {
  id: string;
  name: string;
}

export const TRAY_CAMERA_LIMIT = 6;
const NAME_LIMIT = 40;
const CAMERA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function parseTrayCameras(value: unknown): TrayCamera[] | null {
  if (!Array.isArray(value) || value.length > TRAY_CAMERA_LIMIT) return null;
  const cameras: TrayCamera[] = [];
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object') return null;
    const { id, name } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !CAMERA_ID.test(id)) return null;
    if (typeof name !== 'string') return null;
    const label = name.replace(/\s+/gu, ' ').trim();
    if (label.length === 0) return null;
    cameras.push({ id, name: label });
  }
  return cameras;
}

/** Where a tray entry goes. Opens the camera live in the app. */
export function trayCameraPath(id: string): string {
  return `/cameras/${encodeURIComponent(id)}`;
}

export const WALL_PATH = '/wall';

/** The menu text for a camera. `&` would otherwise mark a Windows mnemonic. */
export function trayCameraLabel(camera: TrayCamera): string {
  const name =
    camera.name.length > NAME_LIMIT
      ? `${camera.name.slice(0, NAME_LIMIT - 1)}…`
      : camera.name;
  return `Watch ${name.replace(/&/gu, '&&')}`;
}

/** The wall needs at least two cameras to be worth a menu entry. */
export function showsWall(cameras: readonly TrayCamera[]): boolean {
  return cameras.length >= 2;
}
