export interface AccessEvent {
  actorEmail: string | null;
  cameraName: string | null;
  deviceName: string | null;
  eventType:
    | 'camera_source_deleted'
    | 'device_credential_revoked'
    | 'device_deleted'
    | 'device_self_removed'
    | 'live_view_started'
    | 'live_view_rejected'
    | 'privacy_disabled'
    | 'privacy_enabled';
  occurredAt: string;
  success: boolean;
  viewerSessionId: string | null;
  reason: string | null;
}

export interface AccessEventPresentation {
  detail: string | null;
  label: string;
  tone: 'danger' | 'neutral' | 'success' | 'warning';
}

export function accessEventPresentation(
  event: AccessEvent,
): AccessEventPresentation {
  switch (event.eventType) {
    case 'live_view_started':
      return { detail: null, label: 'Live view started', tone: 'success' };
    case 'live_view_rejected':
      return {
        detail: rejectionReasonLabel(event.reason),
        label: 'Access rejected',
        tone: 'warning',
      };
    case 'privacy_enabled':
      return {
        detail: 'Capture stopped',
        label: 'Privacy mode enabled',
        tone: 'neutral',
      };
    case 'privacy_disabled':
      return {
        detail: 'Camera available again',
        label: 'Privacy mode disabled',
        tone: 'success',
      };
    case 'device_credential_revoked':
      return {
        detail: 'Pairing required to reconnect',
        label: 'Camera access revoked',
        tone: 'warning',
      };
    case 'camera_source_deleted':
      return {
        detail: 'Camera source removed',
        label: 'Camera deleted',
        tone: 'danger',
      };
    case 'device_deleted':
    case 'device_self_removed':
      return {
        detail: 'Device and its camera sources removed',
        label: 'Camera device deleted',
        tone: 'danger',
      };
  }
}

export interface AccessEventGroup {
  key: string;
  latest: AccessEvent;
  attempts: number;
}

/** Human-readable text for a rejection reason code. Falls back to a generic
 * label for any reason this build doesn't recognize yet, rather than
 * showing a raw backend code to the user. */
export function rejectionReasonLabel(reason: string | null): string {
  if (reason === 'camera_offline') return 'camera offline';
  if (reason === 'not_authorized') return 'not authorized';
  return 'connection could not be established';
}

/** Groups consecutive access-history rows (already newest-first) that
 * share a server-recorded viewer_session_id into one continuous attempt,
 * instead of guessing from timestamp proximity. Rows with no session id
 * (older data, or a different event type) are never grouped. */
export function groupAccessEvents(events: AccessEvent[]): AccessEventGroup[] {
  const groups: AccessEventGroup[] = [];
  events.forEach((event, index) => {
    const last = groups.at(-1);
    if (
      event.eventType.startsWith('live_view_') &&
      event.viewerSessionId &&
      last?.latest.viewerSessionId === event.viewerSessionId
    ) {
      last.attempts += 1;
      return;
    }
    groups.push({
      attempts: 1,
      key: `${event.viewerSessionId ?? 'solo'}-${index}`,
      latest: event,
    });
  });
  return groups;
}
