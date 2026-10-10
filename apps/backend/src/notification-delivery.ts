import { GoogleAuth } from 'google-auth-library';
import webPush from 'web-push';

import type { AppConfig } from './config.js';
import type { DesktopAlertMessage } from './household-events.js';
import type {
  NotificationDelivery,
  NotificationDeliveryOutcome,
} from './notification-types.js';
import { isPushServiceEndpoint } from './push-endpoint.js';

const MAX_RETRY_AFTER_MS = 2 * 60 * 60 * 1_000;

export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - now;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  return Math.min(Math.ceil(milliseconds), MAX_RETRY_AFTER_MS);
}

/** Delivers a desktop alert to one session's live realtime connection(s)
 * and returns how many received it (HouseholdEventHub.sendToSession). */
export type DesktopAlertTransport = (
  sessionId: string,
  message: DesktopAlertMessage,
) => number;

/** Desktop alerts have no push service to hold them while the app is
 * offline, so the outbox retries (1 min, 5 min, 30 min, ...) only while the
 * alert is still useful -- mirroring Web Push TTLs of 15 minutes for motion
 * and an hour otherwise -- and then lets it expire. */
export function desktopAttemptLimit(category: string | undefined): number {
  return category === 'motion' ? 2 : 3;
}

export class NotificationSender {
  readonly #googleAuth: GoogleAuth | null;

  constructor(
    private readonly config: AppConfig,
    private readonly desktopTransport?: DesktopAlertTransport,
  ) {
    this.#googleAuth = config.FIREBASE_PROJECT_ID
      ? new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        })
      : null;
    if (
      config.WEB_PUSH_VAPID_SUBJECT &&
      config.WEB_PUSH_VAPID_PUBLIC_KEY &&
      config.WEB_PUSH_VAPID_PRIVATE_KEY
    ) {
      webPush.setVapidDetails(
        config.WEB_PUSH_VAPID_SUBJECT,
        config.WEB_PUSH_VAPID_PUBLIC_KEY,
        config.WEB_PUSH_VAPID_PRIVATE_KEY,
      );
    }
  }

  async send(
    delivery: NotificationDelivery,
  ): Promise<NotificationDeliveryOutcome> {
    if (delivery.channel === 'fcm') return this.#sendFcm(delivery);
    if (delivery.channel === 'desktop') return this.#sendDesktop(delivery);
    return this.#sendWebPush(delivery);
  }

  #sendDesktop(delivery: NotificationDelivery): NotificationDeliveryOutcome {
    const { category, eventId, route } = delivery.safePayload;
    // providerMaterial for the desktop channel is the subscribing session.
    const delivered =
      category && eventId
        ? (this.desktopTransport?.(delivery.providerMaterial, {
            category,
            eventId,
            route: route === 'settings' ? '/settings' : '/activity',
            type: 'notification',
          }) ?? 0)
        : 0;
    if (delivered > 0) return { permanent: false, success: true };
    return delivery.attemptCount >= desktopAttemptLimit(category)
      ? { expired: true, permanent: false, success: false }
      : { permanent: false, success: false };
  }

  async #sendFcm(
    delivery: NotificationDelivery,
  ): Promise<NotificationDeliveryOutcome> {
    if (!this.#googleAuth || !this.config.FIREBASE_PROJECT_ID) {
      return { permanent: false, success: false };
    }
    try {
      const client = await this.#googleAuth.getClient();
      const accessToken = await client.getAccessToken();
      if (!accessToken.token) return { permanent: false, success: false };
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.config.FIREBASE_PROJECT_ID)}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: delivery.providerMaterial,
              data: delivery.safePayload,
              android: {
                priority: 'high',
                ttl:
                  delivery.safePayload.category === 'motion' ? '900s' : '3600s',
                restrictedPackageName: 'com.beaconsecureview.camera',
              },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.ok) return { permanent: false, success: true };
      const error = (await response.json().catch(() => null)) as {
        error?: { status?: string; details?: Array<{ errorCode?: string }> };
      } | null;
      const unregistered =
        response.status === 404 ||
        error?.error?.status === 'UNREGISTERED' ||
        error?.error?.details?.some(
          (detail) =>
            detail.errorCode === 'UNREGISTERED' ||
            detail.errorCode === 'INSTALLATION_ID_NOT_REGISTERED',
        );
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      return {
        permanent: Boolean(unregistered),
        ...(retryAfterMs ? { retryAfterMs } : {}),
        success: false,
      };
    } catch {
      return { permanent: false, success: false };
    }
  }

  async #sendWebPush(
    delivery: NotificationDelivery,
  ): Promise<NotificationDeliveryOutcome> {
    if (!this.config.WEB_PUSH_VAPID_PRIVATE_KEY) {
      return { permanent: false, success: false };
    }
    try {
      const subscription = JSON.parse(
        delivery.providerMaterial,
      ) as webPush.PushSubscription;
      // Subscriptions saved before the allow-list existed are not called.
      if (!isPushServiceEndpoint(subscription.endpoint)) {
        return { permanent: true, success: false };
      }
      await webPush.sendNotification(
        subscription,
        JSON.stringify(delivery.safePayload),
        {
          TTL: delivery.safePayload.category === 'motion' ? 900 : 3600,
          urgency: 'high',
        },
      );
      return { permanent: false, success: true };
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error && 'statusCode' in error
          ? Number(error.statusCode)
          : 0;
      const headers =
        typeof error === 'object' && error && 'headers' in error
          ? (error.headers as Record<string, string> | undefined)
          : undefined;
      const retryAfterMs = parseRetryAfter(headers?.['retry-after']);
      return {
        permanent: statusCode === 404 || statusCode === 410,
        ...(retryAfterMs ? { retryAfterMs } : {}),
        success: false,
      };
    }
  }
}
