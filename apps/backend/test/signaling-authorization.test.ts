import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import { monitorAuthorization } from '../src/signaling-route.js';

class MockSocket extends EventEmitter {
  readonly close = vi.fn();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('active signaling authorization', () => {
  it('closes promptly after authorization is revoked', async () => {
    vi.useFakeTimers();
    const socket = new MockSocket();
    monitorAuthorization(
      socket as unknown as WebSocket,
      () => Promise.resolve(false),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.close).toHaveBeenCalledWith(4003, 'Authorization lost');
    socket.emit('close');
  });

  it('uses a sanitized close reason when validation fails', async () => {
    vi.useFakeTimers();
    const socket = new MockSocket();
    monitorAuthorization(
      socket as unknown as WebSocket,
      () => Promise.reject(new Error('credential-sensitive database detail')),
      1_000,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.close).toHaveBeenCalledWith(
      1011,
      'Authorization check failed',
    );
    expect(JSON.stringify(socket.close.mock.calls)).not.toContain(
      'credential-sensitive',
    );
    socket.emit('close');
  });
});
