import type { AccessibleCameraRecord, CameraRecord } from './store.js';

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

export interface CameraViewerContext {
  role: 'owner' | 'admin' | 'viewer' | 'guest';
  userId: string;
}

/** Owner/admin can remove any camera; anyone else only the one they
 * personally paired -- see the `cameras.paired_by_user_id` column. */
export function canRemoveCamera(
  camera: Pick<CameraRecord, 'pairedByUserId'>,
  viewer: CameraViewerContext,
): boolean {
  return (
    viewer.role === 'owner' ||
    viewer.role === 'admin' ||
    camera.pairedByUserId === viewer.userId
  );
}

/** A viewer/guest can always drop their own access to a camera someone
 * else shared with them -- it's their own grant row, so there's nothing to
 * confirm beyond "is this actually a grant-gated role." Owner/admin see
 * every camera unconditionally and have no grant to leave. */
export function canLeaveCamera(viewer: CameraViewerContext): boolean {
  return viewer.role === 'viewer' || viewer.role === 'guest';
}

export function presentCamera(
  camera: AccessibleCameraRecord,
  status: CameraConnectionStatus,
  viewer: CameraViewerContext,
) {
  return {
    availability: status.producerConnected ? 'available' : 'unavailable',
    canFlip: camera.canFlip,
    canLeave: canLeaveCamera(viewer),
    canListen: camera.canListen,
    canPause: camera.canPause,
    canRemove: canRemoveCamera(camera, viewer),
    canTalk: camera.canTalk,
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
    useCase: camera.useCase,
    viewerCount: status.viewerCount,
  } as const;
}
