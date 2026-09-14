export interface AccessEvent {
  actorEmail: string | null;
  deviceName: string | null;
  eventType: 'live_view_started' | 'live_view_rejected';
  occurredAt: string;
  success: boolean;
  viewerSessionId: string | null;
  reason: string | null;
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
