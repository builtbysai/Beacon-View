import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportTrayCameras, trayCameras } from './desktop-tray';

const camera = (n: number) => ({
  deviceId: `device-${n}`,
  id: `camera-${n}`,
  name: `Camera ${n}`,
});
const cameras = [1, 2, 3, 4, 5, 6, 7, 8].map(camera);

afterEach(() => {
  delete (window as { beaconDesktop?: unknown }).beaconDesktop;
});

describe('trayCameras', () => {
  it('lists the favorites in the person’s order', () => {
    expect(trayCameras(cameras, ['device-3', 'device-1'])).toEqual([
      { id: 'camera-3', name: 'Camera 3' },
      { id: 'camera-1', name: 'Camera 1' },
    ]);
  });

  it('falls back to the first four when nothing is chosen, and honors an empty choice', () => {
    expect(trayCameras(cameras, null).map((item) => item.id)).toEqual([
      'camera-1',
      'camera-2',
      'camera-3',
      'camera-4',
    ]);
    expect(trayCameras(cameras, [])).toEqual([]);
  });

  it('skips favorites that are gone and caps the list at six', () => {
    expect(trayCameras(cameras, ['device-99', 'device-2'])).toEqual([
      { id: 'camera-2', name: 'Camera 2' },
    ]);
    expect(
      trayCameras(
        cameras,
        cameras.map((item) => item.deviceId),
      ),
    ).toHaveLength(6);
  });
});

describe('reportTrayCameras', () => {
  it('does nothing in an ordinary browser', () => {
    expect(() => reportTrayCameras([{ id: 'a', name: 'A' }])).not.toThrow();
  });

  it('sends the list to the desktop app, and skips an older app without support', () => {
    const setTrayCameras = vi.fn();
    (window as { beaconDesktop?: unknown }).beaconDesktop = {
      setCaptureActive: vi.fn(),
      setTrayCameras,
      version: 1,
    };
    reportTrayCameras([{ id: 'a', name: 'A' }]);
    expect(setTrayCameras).toHaveBeenCalledWith([{ id: 'a', name: 'A' }]);

    (window as { beaconDesktop?: unknown }).beaconDesktop = {
      setCaptureActive: vi.fn(),
      version: 1,
    };
    expect(() => reportTrayCameras([])).not.toThrow();
  });
});
