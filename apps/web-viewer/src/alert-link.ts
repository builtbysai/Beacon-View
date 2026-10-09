import { request } from './api';

/**
 * Opening an alert (ADR 0090). Push payloads stay generic (ADR 0044): they
 * carry only an opaque event ID. When someone taps one, the app opens
 * `/activity?alert=<eventId>` and asks the server, as the signed-in user,
 * which camera it was about.
 */
export const ALERT_PARAM = 'alert';

const EVENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface AlertTarget {
  /** The camera to open, or null when there is none (or no access). */
  cameraId: string | null;
  category: string;
}

/**
 * Reads and removes `?alert=` from the address, so a reload or a shared
 * link doesn't reopen it. Returns null for a missing or malformed ID.
 */
export function takeAlertId(): string | null {
  const parameters = new URLSearchParams(window.location.search);
  const value = parameters.get(ALERT_PARAM);
  if (value === null) return null;
  parameters.delete(ALERT_PARAM);
  const search = parameters.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
  );
  return EVENT_ID.test(value) ? value : null;
}

/** Null when the alert is unknown, expired, or not this user's. */
export async function resolveAlert(
  eventId: string,
): Promise<AlertTarget | null> {
  try {
    return await request<AlertTarget>(
      `/api/notification-events/${encodeURIComponent(eventId)}`,
    );
  } catch {
    return null;
  }
}

/** Where an alert should land, given the cameras the person can see. */
export function alertDestination(
  target: AlertTarget | null,
  cameraIds: readonly string[],
): { cameraId: string } | 'activity' {
  if (target?.cameraId && cameraIds.includes(target.cameraId))
    return { cameraId: target.cameraId };
  return 'activity';
}
