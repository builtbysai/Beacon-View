export interface SelectableCamera {
  availability?: string;
  deviceId: string;
  id: string;
  online?: boolean;
  streaming: boolean;
}

/** Represent each physical device once in list and grid views. Prefer the
 * source currently streaming, then an online source, then the first source
 * reported by the backend. */
export function groupCamerasByDevice<T extends SelectableCamera>(
  cameras: T[],
): T[] {
  const byDevice = new Map<string, T[]>();
  for (const camera of cameras) {
    const sources = byDevice.get(camera.deviceId) ?? [];
    sources.push(camera);
    byDevice.set(camera.deviceId, sources);
  }
  return [...byDevice.values()].map(
    (sources) =>
      sources.find((source) => source.streaming) ??
      sources.find((source) => source.online) ??
      sources[0]!,
  );
}

/** Keep a live view attached to the physical device when its active camera
 * source changes or the selected source is removed. */
export function reconcileLiveCamera<T extends SelectableCamera>(
  selected: T,
  refreshed: T[],
): T | null {
  const sources = refreshed.filter(
    (camera) => camera.deviceId === selected.deviceId,
  );
  const active =
    sources.find((camera) => camera.availability === 'available') ??
    sources.find((camera) => camera.streaming);
  return active ?? sources.find((camera) => camera.id === selected.id) ?? null;
}
