import { describe, expect, it } from 'vitest';
import { groupCamerasByDevice, reconcileLiveCamera } from './camera-selection';

const rear = {
  availability: 'available',
  deviceId: 'phone',
  id: 'rear',
  streaming: true,
};

describe('live camera selection', () => {
  it('follows a source switch on the same physical device', () => {
    expect(
      reconcileLiveCamera(rear, [
        { ...rear, availability: 'unavailable', streaming: false },
        { ...rear, availability: 'available', id: 'front' },
      ])?.id,
    ).toBe('front');
  });

  it('keeps viewing a remaining source after the current source is deleted', () => {
    expect(
      reconcileLiveCamera(rear, [
        { ...rear, availability: 'available', id: 'front' },
      ])?.id,
    ).toBe('front');
  });

  it('ends the view when the device has no sources left', () => {
    expect(reconcileLiveCamera(rear, [])).toBeNull();
  });
});

describe('camera device grouping', () => {
  it('selects one representative source per physical device', () => {
    const cameras = [
      { ...rear, online: false, streaming: false },
      { ...rear, id: 'front', online: true, streaming: false },
      {
        ...rear,
        deviceId: 'laptop',
        id: 'webcam',
        online: true,
        streaming: true,
      },
    ];

    expect(groupCamerasByDevice(cameras).map((camera) => camera.id)).toEqual([
      'front',
      'webcam',
    ]);
  });

  it('prefers the streaming source even when another source is online', () => {
    expect(
      groupCamerasByDevice([
        { ...rear, online: true, streaming: false },
        { ...rear, id: 'front', online: true, streaming: true },
      ])[0]?.id,
    ).toBe('front');
  });
});
