import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  androidApp,
  androidAppVersion,
  isAndroidApp,
  isNewerAndroidVersion,
  onAndroidCameraState,
  sendToAndroid,
} from './android-shell';

type Listener = (event: { data: unknown }) => void;

function installBridge() {
  const sent: Array<Record<string, unknown>> = [];
  let listener: Listener | null = null;
  window.BeaconAndroid = {
    addEventListener: (_type, next) => {
      listener = next;
    },
    postMessage: (message: string) => {
      sent.push(JSON.parse(message) as Record<string, unknown>);
    },
  };
  return {
    emit: (value: unknown) => listener?.({ data: JSON.stringify(value) }),
    sent,
  };
}

afterEach(() => {
  delete window.BeaconAndroid;
  vi.useRealTimers();
});

describe('the Android app bridge', () => {
  it('is absent in an ordinary browser and every helper fails quietly', async () => {
    expect(isAndroidApp()).toBe(false);
    await expect(sendToAndroid('hello')).rejects.toThrow(
      'Not in the Beacon app',
    );
    const stop = onAndroidCameraState(() => undefined);
    stop();
  });

  it('sends a message with an id and resolves with the app’s answer', async () => {
    const bridge = installBridge();
    expect(isAndroidApp()).toBe(true);
    const answer = androidApp.startCamera('ABCD234567');
    expect(bridge.sent).toHaveLength(1);
    expect(bridge.sent[0]).toMatchObject({
      code: 'ABCD234567',
      type: 'startCamera',
    });
    bridge.emit({ data: { done: true }, id: bridge.sent[0]!.id, ok: true });
    await expect(answer).resolves.toEqual({ done: true });
  });

  it('rejects when the app refuses, and ignores answers it did not ask for', async () => {
    const bridge = installBridge();
    const answer = androidApp.openUpdate();
    bridge.emit({ error: 'nope', id: 'someone-else', ok: false });
    bridge.emit({ error: 'No update.', id: bridge.sent[0]!.id, ok: false });
    await expect(answer).rejects.toThrow('No update.');
  });

  it('gives up after eight seconds without an answer', async () => {
    vi.useFakeTimers();
    installBridge();
    const answer = androidApp.hello();
    const result = expect(answer).rejects.toThrow('did not answer');
    await vi.advanceTimersByTimeAsync(8_001);
    await result;
  });

  it('delivers camera events to listeners until they stop', () => {
    const bridge = installBridge();
    const seen: unknown[] = [];
    const stop = onAndroidCameraState((state) => seen.push(state));
    bridge.emit({ data: { paired: true, privacy: true }, event: 'camera' });
    stop();
    bridge.emit({ data: { paired: false }, event: 'camera' });
    expect(seen).toEqual([{ paired: true, privacy: true }]);
  });

  it('reads the app version from the user agent', () => {
    expect(
      androidAppVersion('Mozilla/5.0 Chrome/150 BeaconApp/0.1.0-alpha13'),
    ).toBe('0.1.0-alpha13');
    expect(androidAppVersion('Mozilla/5.0 Chrome/150')).toBeNull();
  });
});

describe('isNewerAndroidVersion', () => {
  it('compares numbers as numbers and a release as later than its alphas', () => {
    expect(isNewerAndroidVersion('0.1.0-alpha13', '0.1.0-alpha9')).toBe(true);
    expect(isNewerAndroidVersion('0.1.0-alpha9', '0.1.0-alpha13')).toBe(false);
    expect(isNewerAndroidVersion('0.1.0', '0.1.0-alpha13')).toBe(true);
    expect(isNewerAndroidVersion('0.1.0-alpha13', '0.1.0')).toBe(false);
    expect(isNewerAndroidVersion('0.1.0-alpha13', '0.1.0-alpha13')).toBe(false);
  });
});
