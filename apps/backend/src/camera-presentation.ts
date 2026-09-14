import type { CameraRecord } from './store.js';

const ONLINE_WINDOW = 90 * 1_000;

export interface CameraConnectionStatus {
  producerConnected: boolean;
  viewerCount: number;
}

export function isCameraOnline(
  lastSeenAt: Date | null,
  now = new Date(),
): boolean {
  return (
    lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW
  );
}

export function presentCamera(
  camera: CameraRecord,
  status: CameraConnectionStatus,
) {
  return {
    availability: status.producerConnected ? 'available' : 'unavailable',
    capabilities: camera.capabilities,
    credentialRevoked: camera.credentialRevokedAt !== null,
    deviceId: camera.publicDeviceId,
    deviceName: camera.deviceName,
    enabled: camera.enabled,
    facing: camera.facing,
    id: camera.publicCameraId,
    lastSeenAt: camera.lastSeenAt?.toISOString() ?? null,
    name: camera.name,
    online:
      camera.enabled &&
      !camera.privacyMode &&
      camera.credentialRevokedAt === null &&
      status.producerConnected,
    platform: camera.platform,
    privacyMode: camera.privacyMode,
    sourceKey: camera.sourceKey,
    streaming: status.viewerCount > 0,
    viewerCount: status.viewerCount,
  } as const;
}
