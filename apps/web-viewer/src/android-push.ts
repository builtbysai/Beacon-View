import { androidApp } from './android-shell';
import { request } from './api';

/**
 * Phone alerts in the Android app (ADR 0121). The app owns Firebase; this web app owns the account: it registers the
 * token with the signed-in session and tells the app the subscription id.
 */
export async function registerAndroidAlerts(): Promise<void> {
  const { installationId, token } = await androidApp.enablePush();
  const result = await request<{ id: string }>(
    '/api/notification-subscriptions',
    {
      body: JSON.stringify({
        channel: 'fcm',
        deviceLabel: 'Beacon Android app',
        installationId,
        token,
      }),
      method: 'POST',
    },
  );
  await androidApp.pushEnabled(result.id);
}

/** Turns alerts off on this phone and removes the subscription from the account. */
export async function removeAndroidAlerts(): Promise<void> {
  const { subscriptionId } = await androidApp.disablePush();
  if (subscriptionId)
    await request(
      `/api/notification-subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: 'DELETE' },
    ).catch(() => undefined);
}

/** Run once the person is signed in inside the app: when Firebase rotated the token, register the new one. */
export async function syncAndroidAlerts(): Promise<void> {
  const hello = await androidApp.hello();
  if (hello.push?.enabled && hello.push.stale) await registerAndroidAlerts();
}
