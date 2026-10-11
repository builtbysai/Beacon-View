import { describe, expect, it, vi } from 'vitest';

// The receiver is plain JavaScript served as-is, so it is imported directly.
import { NAMESPACE, start, watchPath } from '../public/cast/receiver.js';
import { CAST_NAMESPACE, castWatchPath } from './cast-sender';

const token = 'A'.repeat(43);

describe('Cast messages', () => {
  it('uses one namespace on both ends', () => {
    expect(NAMESPACE).toBe(CAST_NAMESPACE);
  });

  it('opens exactly what the sender builds', () => {
    expect(watchPath({ path: castWatchPath(token), type: 'watch' })).toBe(
      `/g/${token}?cast=1`,
    );
  });

  it('refuses anything that is not a guest-link path on this site', () => {
    for (const path of [
      'https://evil.example/g/' + token + '?cast=1',
      '//evil.example/g/' + token + '?cast=1',
      '/g/short?cast=1',
      `/g/${token}`,
      `/g/${token}?cast=1&x=1`,
      `/settings?cast=1`,
      `/g/../${token}?cast=1`,
      'javascript:alert(1)',
      7,
      null,
    ])
      expect(watchPath({ path, type: 'watch' })).toBeNull();
    expect(watchPath({ path: castWatchPath(token), type: 'other' })).toBeNull();
    expect(watchPath(null)).toBeNull();
    expect(watchPath('watch')).toBeNull();
  });

  it('registers its message listener with the Cast receiver API and shows the camera', () => {
    // Only the real CAF method names exist on this fake, so a misspelled call
    // (as addCustomMessageHandler was) throws here instead of on the TV.
    const listeners = new Map<string, (event: { data: unknown }) => void>();
    const context = {
      addCustomMessageListener: (
        namespace: string,
        listener: (event: { data: unknown }) => void,
      ) => listeners.set(namespace, listener),
      start: vi.fn(),
    };
    vi.stubGlobal('cast', {
      framework: {
        CastReceiverContext: { getInstance: () => context },
        system: { MessageType: { JSON: 'JSON' } },
      },
    });
    (window as unknown as { cast: unknown }).cast = (
      globalThis as unknown as { cast: unknown }
    ).cast;
    const frame = document.createElement('iframe');
    const idle = document.createElement('div');
    start(frame, idle);
    expect(context.start).toHaveBeenCalledWith(
      expect.objectContaining({ disableIdleTimeout: true }),
    );
    listeners.get(NAMESPACE)?.({
      data: { path: castWatchPath(token), type: 'watch' },
    });
    expect(frame.getAttribute('src')).toBe(`/g/${token}?cast=1`);
    expect(frame.hidden).toBe(false);
    expect(idle.hidden).toBe(true);
    listeners.get(NAMESPACE)?.({ data: { type: 'stop' } });
    expect(frame.hidden).toBe(true);
    delete (window as unknown as { cast?: unknown }).cast;
    vi.unstubAllGlobals();
  });
});
