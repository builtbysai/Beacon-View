import type { Camera } from './domain';

export type WallColumns = 'auto' | 1 | 2 | 3;
export interface WallLayout {
  name: string;
  deviceIds: string[];
  columns: WallColumns;
}
export const MAX_SAVED_LAYOUTS = 20;
export const MAX_LAYOUT_CAMERAS = 9;

export function wallStorageKey(userId: string, householdId: string): string {
  return `beacon.wall.layouts.v1:${encodeURIComponent(userId)}:${encodeURIComponent(householdId)}`;
}

export function validLayout(value: unknown): value is WallLayout {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WallLayout>;
  return (
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    item.name.length <= 60 &&
    ['auto', 1, 2, 3].includes(item.columns!) &&
    Array.isArray(item.deviceIds) &&
    item.deviceIds.length > 0 &&
    item.deviceIds.length <= MAX_LAYOUT_CAMERAS &&
    item.deviceIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 200,
    ) &&
    new Set(item.deviceIds).size === item.deviceIds.length
  );
}

export function loadWallLayouts(key: string): WallLayout[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const names = new Set<string>();
    return parsed
      .filter(validLayout)
      .filter((layout) => {
        const name = layout.name.trim().toLocaleLowerCase();
        if (names.has(name)) return false;
        names.add(name);
        return true;
      })
      .slice(0, MAX_SAVED_LAYOUTS);
  } catch {
    return [];
  }
}

/** Failure leaves the current in-memory layouts usable for this page. */
export function saveWallLayouts(key: string, layouts: WallLayout[]): boolean {
  if (layouts.length > MAX_SAVED_LAYOUTS || !layouts.every(validLayout))
    return false;
  try {
    localStorage.setItem(key, JSON.stringify(layouts));
    return true;
  } catch {
    return false;
  }
}

/** Resolve only against the current grant-filtered inventory. Device IDs keep
 * the active lens selected when a camera switches source. */
export function layoutCameras(
  cameras: Camera[],
  deviceIds: string[],
): Camera[] {
  const devices = new Map(cameras.map((camera) => [camera.deviceId, camera]));
  return deviceIds.flatMap((id) => {
    const camera = devices.get(id);
    return camera ? [camera] : [];
  });
}
