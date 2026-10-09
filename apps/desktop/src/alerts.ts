/**
 * Desktop alerts (ADR 0083). The backend decides whether to alert, using the
 * same per-camera preferences and quiet hours as Web Push and FCM, and sends
 * a generic payload over the app's authenticated realtime connection. The
 * copy matches the PWA service worker (apps/web-viewer/public/sw.js): no
 * camera names or event details ever appear in an OS notification.
 */
export type AlertCategory =
  'motion' | 'offline' | 'recovered' | 'security' | 'health';

export interface DesktopAlert {
  category: AlertCategory;
  eventId: string;
  route: '/activity' | '/settings';
}

export const ALERT_BODY: Record<AlertCategory, string> = {
  motion: 'Beacon detected activity.',
  offline: 'A Beacon camera needs attention.',
  recovered: 'A Beacon camera is back online.',
  health: 'A Beacon camera has a battery or heat warning.',
  security: 'A security event occurred on your Beacon account.',
};

const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseDesktopAlert(value: unknown): DesktopAlert | null {
  if (!value || typeof value !== 'object') return null;
  const { category, eventId, route } = value as Record<string, unknown>;
  if (
    typeof category !== 'string' ||
    !Object.hasOwn(ALERT_BODY, category) ||
    typeof eventId !== 'string' ||
    !EVENT_ID.test(eventId) ||
    (route !== '/activity' && route !== '/settings')
  )
    return null;
  return { category: category as AlertCategory, eventId, route };
}

/** Where clicking an alert goes. Activity alerts carry their opaque event
 * ID so the app can open the camera they were about (ADR 0090). */
export function alertPath(alert: DesktopAlert): string {
  return alert.route === '/activity'
    ? `/activity?alert=${alert.eventId}`
    : alert.route;
}

/** The same event can arrive twice (a retried delivery after a reconnect);
 * the person should see it once. */
export class RecentAlerts {
  readonly #seen: string[] = [];

  constructor(private readonly limit = 200) {}

  firstSighting(eventId: string): boolean {
    if (this.#seen.includes(eventId)) return false;
    this.#seen.push(eventId);
    if (this.#seen.length > this.limit) this.#seen.shift();
    return true;
  }
}
