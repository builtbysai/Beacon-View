import type { MilestoneStore } from './store.js';

export const DRIVE_RECONNECT_MESSAGE =
  'Google Drive is disconnected. Reconnect it in Settings → Data & storage to keep recording.';

/** Drops a Drive connection whose refresh token Google no longer accepts,
 * so Beacon stops offering recordings that would fail and asks the owner to
 * reconnect instead. The token is already dead, so there is nothing to
 * revoke at Google. */
export async function expireDriveConnection(
  store: MilestoneStore,
  userId: string,
  householdId?: string,
): Promise<void> {
  const removed = await store.removeGoogleDriveConnection(userId);
  if (removed)
    await store.audit({
      eventType: 'google_drive_connection_expired',
      success: true,
      userId,
      ...(householdId ? { householdId } : {}),
    });
}

/** /api/drive/status re-checks a connection at most this often, so a dead
 * token is noticed before the owner tries to record. */
export const DRIVE_HEALTH_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
