import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAndroidAlerts,
  removeAndroidAlerts,
  syncAndroidAlerts,
} from './android-push';

const request = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('./api', () => ({
  request: (...args: unknown[]): unknown => request(...args),
}));

type Handler = (message: Record<string, unknown>) => unknown;

/** A fake app: answers each message with whatever `answer` returns for its type. */
function installApp(answer: Record<string, Handler>) {
  const sent: Array<Record<string, unknown>> = [];
  let listener: ((event: { data: unknown }) => void) | null = null;
  window.BeaconAndroid = {
    addEventListener: (_type, next) => {
      listener = next;
    },
    postMessage: (raw: string) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      sent.push(message);
      const data = answer[String(message.type)]?.(message) ?? {};
      queueMicrotask(() =>
        listener?.({
          data: JSON.stringify({ data, id: message.id, ok: true }),
        }),
      );
    },
  };
  return sent;
}

beforeEach(() => {
  request.mockReset();
});
afterEach(() => {
  delete window.BeaconAndroid;
});

describe('phone alerts through the Android app', () => {
  it('registers the app’s token with the signed-in session, then tells the app the subscription id', async () => {
    request.mockResolvedValue({ id: 'sub-12345678' });
    const sent = installApp({
      enablePush: () => ({ installationId: 'install-1', token: 'fcm-token' }),
    });
    await registerAndroidAlerts();
    expect(request).toHaveBeenCalledWith('/api/notification-subscriptions', {
      body: JSON.stringify({
        channel: 'fcm',
        deviceLabel: 'Beacon Android app',
        installationId: 'install-1',
        token: 'fcm-token',
      }),
      method: 'POST',
    });
    expect(sent.map((message) => message.type)).toEqual([
      'enablePush',
      'pushEnabled',
    ]);
    expect(sent[1]).toMatchObject({ subscriptionId: 'sub-12345678' });
  });

  it('removes the subscription the app reports when alerts are turned off', async () => {
    request.mockResolvedValue({});
    installApp({ disablePush: () => ({ subscriptionId: 'sub-12345678' }) });
    await removeAndroidAlerts();
    expect(request).toHaveBeenCalledWith(
      '/api/notification-subscriptions/sub-12345678',
      {
        method: 'DELETE',
      },
    );
  });

  it('removes nothing when the app had no subscription', async () => {
    installApp({ disablePush: () => ({ subscriptionId: null }) });
    await removeAndroidAlerts();
    expect(request).not.toHaveBeenCalled();
  });

  it('registers again only when alerts are on and Firebase changed the token', async () => {
    request.mockResolvedValue({ id: 'sub-87654321' });
    installApp({
      enablePush: () => ({ installationId: 'i', token: 't' }),
      hello: () => ({
        app: 'android',
        camera: {},
        push: { enabled: true, stale: false },
        version: 'x',
      }),
    });
    await syncAndroidAlerts();
    expect(request).not.toHaveBeenCalled();

    installApp({
      enablePush: () => ({ installationId: 'i', token: 't2' }),
      hello: () => ({
        app: 'android',
        camera: {},
        push: { enabled: true, stale: true },
        version: 'x',
      }),
    });
    await syncAndroidAlerts();
    expect(request).toHaveBeenCalledTimes(1);

    request.mockClear();
    installApp({
      hello: () => ({
        app: 'android',
        camera: {},
        push: { enabled: false, stale: true },
        version: 'x',
      }),
    });
    await syncAndroidAlerts();
    expect(request).not.toHaveBeenCalled();
  });
});
