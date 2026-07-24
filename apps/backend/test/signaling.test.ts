import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { SignalingHub } from '../src/signaling.js';

class MockSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly sent: unknown[] = [];

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  message(value: object): void {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
}

function socket(): { mock: MockSocket; ws: WebSocket } {
  const mock = new MockSocket();
  return { mock, ws: mock as unknown as WebSocket };
}

describe('SignalingHub', () => {
  it('routes only role-appropriate messages and cleans up disconnects', () => {
    const servers = [{ urls: ['stun:localhost:3478'] }];
    const hub = new SignalingHub(
      () => servers,
      () => servers,
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice('camera-1', 'public-camera-1', device.ws);
    hub.connectViewer('camera-1', 'public-camera-1', viewer.ws);
    const ready = viewer.mock.sent.at(-1) as { connectionId: string };

    device.mock.message({
      connectionId: ready.connectionId,
      sdp: 'video-offer',
      type: 'offer',
    });
    expect(viewer.mock.sent.at(-1)).toMatchObject({
      sdp: 'video-offer',
      type: 'offer',
    });

    viewer.mock.message({
      connectionId: ready.connectionId,
      sdp: 'not-allowed',
      type: 'offer',
    });
    expect(viewer.mock.sent.at(-1)).toEqual({
      code: 'invalid_message',
      type: 'error',
    });

    viewer.mock.close();
    expect(hub.activeSessionCount).toBe(0);
    expect(device.mock.sent.at(-1)).toEqual({
      code: 'viewer_disconnected',
      type: 'peer-left',
    });
    hub.close();
  });

  it('cleans up an unanswered negotiation after its deterministic timeout', async () => {
    const hub = new SignalingHub(
      () => [{ urls: ['stun:localhost:3478'] }],
      () => [{ urls: ['stun:localhost:3478'] }],
      5,
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice('camera-1', 'public-camera-1', device.ws);
    hub.connectViewer('camera-1', 'public-camera-1', viewer.ws);

    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(hub.activeSessionCount).toBe(0);
    expect(viewer.mock.sent.at(-1)).toEqual({
      code: 'negotiation_timeout',
      type: 'peer-left',
    });
    hub.close();
  });

  it('lets an authorized reconnect replace a stale viewer safely', () => {
    const servers = [{ urls: ['stun:localhost:3478'] }];
    const hub = new SignalingHub(
      () => servers,
      () => servers,
    );
    const device = socket();
    const firstViewer = socket();
    const replacementViewer = socket();
    hub.connectDevice('camera-1', 'public-camera-1', device.ws);
    hub.connectViewer('camera-1', 'public-camera-1', firstViewer.ws);

    expect(
      hub.connectViewer('camera-1', 'public-camera-1', replacementViewer.ws),
    ).toBe(true);
    expect(firstViewer.mock.readyState).toBe(3);
    expect(replacementViewer.mock.sent.at(-1)).toMatchObject({
      type: 'ready',
    });
    expect(hub.activeSessionCount).toBe(1);

    firstViewer.mock.emit('close');
    expect(hub.activeSessionCount).toBe(1);

    hub.close();
  });

  it('emits only sanitized lifecycle diagnostics', () => {
    const diagnostics: unknown[] = [];
    const hub = new SignalingHub(
      () => [
        {
          credential: 'short-lived-password',
          urls: ['turn:localhost:3478'],
          username: 'expiring-user',
        },
      ],
      () => [],
      30_000,
      'all',
      (diagnostic) => diagnostics.push(diagnostic),
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice('internal-camera-id', 'public-camera-id', device.ws);
    hub.connectViewer('internal-camera-id', 'public-camera-id', viewer.ws);
    const ready = viewer.mock.sent.at(-1) as { connectionId: string };
    device.mock.message({
      connectionId: ready.connectionId,
      sdp: 'private-sdp',
      type: 'offer',
    });
    device.mock.message({
      connectionId: ready.connectionId,
      type: 'connected',
    });
    viewer.mock.close();

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).toContain('public-camera-id');
    expect(serialized).not.toContain('internal-camera-id');
    expect(serialized).not.toContain('private-sdp');
    expect(serialized).not.toContain('short-lived-password');
    expect(serialized).not.toContain('expiring-user');
    hub.close();
  });
});
