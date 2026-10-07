import { describe, expect, it } from 'vitest';

import { isCameraOnline, presentCamera } from '../src/camera-presentation.js';
import type { AccessibleCameraRecord } from '../src/store.js';

const now = new Date('2026-09-11T12:00:00.000Z');
const camera: AccessibleCameraRecord = {
  canFlip: true,
  canListen: true,
  canPause: true,
  canTalk: true,
  capabilities: { audio: true },
  credentialRevokedAt: null,
  deviceId: 'internal-device',
  deviceName: 'Hall phone',
  enabled: true,
  facing: 'rear',
  id: 'internal-camera',
  lastSeenAt: new Date(now.getTime() - 90_000),
  name: 'Hall camera',
  pairedByUserId: null,
  platform: 'android',
  privacyMode: false,
  publicCameraId: '11111111-1111-4111-8111-111111111111',
  publicDeviceId: '22222222-2222-4222-8222-222222222222',
  sourceKey: 'rear',
  useCase: 'general',
};
const owner = { role: 'owner', userId: 'owner-user' } as const;

describe('camera API presentation', () => {
  it('uses recent device presence at the online-window boundary', () => {
    expect(isCameraOnline(camera.lastSeenAt, now)).toBe(true);
    expect(isCameraOnline(new Date(now.getTime() - 90_001), now)).toBe(false);
    expect(isCameraOnline(null, now)).toBe(false);
  });

  it('uses a live producer connection even after heartbeat presence expires', () => {
    const presented = presentCamera(
      { ...camera, lastSeenAt: new Date(now.getTime() - 120_000) },
      { producerConnected: true, viewerCount: 2 },
      owner,
    );

    expect(presented).toMatchObject({
      availability: 'available',
      online: true,
      streaming: true,
      viewerCount: 2,
    });
  });

  it('does not call a stale heartbeat an available camera connection', () => {
    const presented = presentCamera(
      camera,
      { producerConnected: false, viewerCount: 0 },
      owner,
    );

    expect(presented).toMatchObject({
      availability: 'unavailable',
      online: false,
      streaming: false,
    });
  });

  it('never presents a disabled or private camera as online', () => {
    const status = { producerConnected: true, viewerCount: 0 };
    expect(
      presentCamera({ ...camera, enabled: false }, status, owner).online,
    ).toBe(false);
    expect(
      presentCamera({ ...camera, privacyMode: true }, status, owner).online,
    ).toBe(false);
    expect(
      presentCamera({ ...camera, credentialRevokedAt: now }, status, owner)
        .online,
    ).toBe(false);
  });

  it('lets owner/admin remove any camera but a viewer only the one they paired', () => {
    const status = { producerConnected: true, viewerCount: 0 };
    const pairedByViewer = { ...camera, pairedByUserId: 'viewer-user' };

    expect(presentCamera(pairedByViewer, status, owner).canRemove).toBe(true);
    expect(
      presentCamera(pairedByViewer, status, {
        role: 'viewer',
        userId: 'viewer-user',
      }).canRemove,
    ).toBe(true);
    expect(
      presentCamera(pairedByViewer, status, {
        role: 'viewer',
        userId: 'someone-else',
      }).canRemove,
    ).toBe(false);
    expect(presentCamera(camera, status, owner).canLeave).toBe(false);
    expect(
      presentCamera(camera, status, { role: 'viewer', userId: 'viewer-user' })
        .canLeave,
    ).toBe(true);
  });
});
