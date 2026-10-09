import { request } from './api';

/**
 * Motion zones (ADR 0092): areas of the picture where movement is ignored. A
 * 16 x 16 grid over the picture as viewers see it, numbered row by row (0 is
 * the top-left cell). Only cell numbers are stored, never an image.
 */
export const ZONE_GRID_SIZE = 16;
export const ZONE_COUNT = ZONE_GRID_SIZE * ZONE_GRID_SIZE;

export interface Rect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** The cell under a point, or null when the point is outside the picture. */
export function cellAtPoint(
  x: number,
  y: number,
  picture: Rect,
): number | null {
  if (picture.width <= 0 || picture.height <= 0) return null;
  const u = (x - picture.left) / picture.width;
  const v = (y - picture.top) / picture.height;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return (
    Math.floor(v * ZONE_GRID_SIZE) * ZONE_GRID_SIZE +
    Math.floor(u * ZONE_GRID_SIZE)
  );
}

/** Every cell the pointer crossed between two points, so a fast drag has no gaps. */
export function cellsBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  picture: Rect,
): number[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const cell = Math.max(1, picture.width / ZONE_GRID_SIZE / 2);
  const steps = Math.max(1, Math.ceil(distance / cell));
  const cells = new Set<number>();
  for (let step = 0; step <= steps; step += 1) {
    const found = cellAtPoint(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
      picture,
    );
    if (found !== null) cells.add(found);
  }
  return [...cells];
}

/** Paints (`ignore`) or erases cells, returning a new set. */
export function paintCells(
  current: ReadonlySet<number>,
  cells: readonly number[],
  ignore: boolean,
): Set<number> {
  const next = new Set(current);
  for (const cell of cells) {
    if (cell < 0 || cell >= ZONE_COUNT) continue;
    if (ignore) next.add(cell);
    else next.delete(cell);
  }
  return next;
}

/** The part of a frame a `contain`-fitted video actually covers. */
export function pictureRect(
  frame: { height: number; width: number },
  video: { height: number; width: number },
): Rect {
  if (!video.width || !video.height || !frame.width || !frame.height)
    return { height: frame.height, left: 0, top: 0, width: frame.width };
  const scale = Math.min(
    frame.width / video.width,
    frame.height / video.height,
  );
  const width = video.width * scale;
  const height = video.height * scale;
  return {
    height,
    left: (frame.width - width) / 2,
    top: (frame.height - height) / 2,
    width,
  };
}

/** "No areas ignored", "1 area ignored", "12 areas ignored". */
export function describeZones(count: number): string {
  if (count === 0) return 'No areas ignored';
  return `${count} ${count === 1 ? 'area' : 'areas'} ignored`;
}

export interface CameraMotionSettings {
  cameraId: string;
  cooldownSeconds: 30 | 60 | 120 | 300;
  enabled: boolean;
  ignoredZones?: number[];
  quietHours: { end: string; start: string; timeZone: string } | null;
  recordOnMotion: boolean;
  sensitivity: 'high' | 'low' | 'medium';
}

export async function loadMotionSettings(
  deviceId: string,
  cameraId: string,
): Promise<CameraMotionSettings | null> {
  const result = await request<{ cameras: CameraMotionSettings[] }>(
    `/api/devices/${encodeURIComponent(deviceId)}/motion-settings`,
  );
  return result.cameras.find((item) => item.cameraId === cameraId) ?? null;
}

/** Saves the zones, keeping every other motion setting as it is. */
export async function saveZones(
  settings: CameraMotionSettings,
  zones: ReadonlySet<number>,
): Promise<number[]> {
  const { cameraId, ...rest } = settings;
  const result = await request<{ settings: CameraMotionSettings }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/motion-settings`,
    {
      body: JSON.stringify({
        ...rest,
        ignoredZones: [...zones].sort((a, b) => a - b),
      }),
      method: 'PUT',
    },
  );
  return result.settings.ignoredZones ?? [];
}
