/** The recording lifecycle as Beacon's backend actually models it (see
 * apps/backend/src/db/schema.ts's recordings_status_valid check and
 * apps/backend/src/recording-routes.ts). Shared between the Activity feed
 * (an inline clip tag on the triggering event) and the Clips library (the
 * clip's own status pill), so the two views never describe the same state
 * two different ways. */
type RecordingStatus =
  'requested' | 'recording' | 'uploading' | 'available' | 'failed' | 'deleting';

export const recordingStatusLabels: Record<RecordingStatus, string> = {
  requested: 'Recording starting',
  recording: 'Recording…',
  uploading: 'Uploading…',
  available: 'Ready',
  failed: 'Recording failed',
  deleting: 'Removing clip',
};

/** "link" once there is a clip to open, "failed" when it never will be,
 * "pending" for every in-progress state in between. */
export function recordingStatusTone(
  status: string,
): 'link' | 'pending' | 'failed' {
  if (status === 'available') return 'link';
  if (status === 'failed') return 'failed';
  return 'pending';
}
