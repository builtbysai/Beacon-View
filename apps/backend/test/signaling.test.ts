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

  readonly closeCodes: (number | undefined)[] = [];

  close(code?: number): void {
    this.closeCodes.push(code);
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
    expect(device.mock.sent.at(-1)).toMatchObject({
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
    expect(viewer.mock.sent.at(-1)).toMatchObject({
      code: 'negotiation_timeout',
      type: 'peer-left',
    });
    hub.close();
  });

  it('keeps independent sessions for multiple authorized viewers', () => {
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
    expect(firstViewer.mock.readyState).toBe(1);
    expect(replacementViewer.mock.sent.at(-1)).toMatchObject({
      type: 'ready',
    });
    expect(hub.activeSessionCount).toBe(2);

    firstViewer.mock.emit('close');
    expect(hub.activeSessionCount).toBe(1);

    hub.close();
  });

  it('immediately disconnects only viewers authenticated by a revoked session', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    const revokedViewer = socket();
    const remainingViewer = socket();
    hub.connectDevice('camera-1', 'public-camera-1', device.ws);
    hub.connectViewer(
      'camera-1',
      'public-camera-1',
      revokedViewer.ws,
      true,
      'session-revoked',
    );
    hub.connectViewer(
      'camera-1',
      'public-camera-1',
      remainingViewer.ws,
      true,
      'session-remaining',
    );

    hub.disconnectSession('session-revoked');

    expect(revokedViewer.mock.readyState).toBe(3);
    expect(remainingViewer.mock.readyState).toBe(1);
    expect(hub.activeSessionCount).toBe(1);
    expect(device.mock.sent).toContainEqual(
      expect.objectContaining({
        code: 'session_revoked',
        type: 'peer-left',
      }),
    );
    hub.close();
  });

  it('counts only connected viewers and publishes count changes immediately', () => {
    const viewerStates: Array<[string, string]> = [];
    const hub = new SignalingHub(
      () => [],
      () => [],
      30_000,
      'all',
      () => undefined,
      () => undefined,
      (householdId, cameraId) => viewerStates.push([householdId, cameraId]),
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice(
      'internal-camera',
      'public-camera',
      device.ws,
      'household',
    );
    hub.connectViewer('internal-camera', 'public-camera', viewer.ws);
    const ready = viewer.mock.sent.at(-1) as { connectionId: string };

    expect(hub.cameraStatus('public-camera').viewerCount).toBe(0);
    device.mock.message({
      connectionId: ready.connectionId,
      type: 'connected',
    });
    expect(hub.cameraStatus('public-camera')).toMatchObject({
      connectionIds: [ready.connectionId],
      viewerCount: 1,
    });
    viewer.mock.close();
    expect(hub.cameraStatus('public-camera')).toMatchObject({
      connectionIds: [],
      viewerCount: 0,
    });
    expect(viewerStates).toEqual([
      ['household', 'public-camera'],
      ['household', 'public-camera'],
    ]);
    hub.close();
  });

  it('grants only one talk channel and releases it on disconnect', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    const first = socket();
    const second = socket();
    hub.connectDevice('camera', 'public-camera', device.ws);
    hub.connectViewer('camera', 'public-camera', first.ws);
    const firstReady = first.mock.sent.at(-1) as { connectionId: string };
    hub.connectViewer('camera', 'public-camera', second.ws);
    const secondReady = second.mock.sent.at(-1) as { connectionId: string };

    first.mock.message({
      connectionId: firstReady.connectionId,
      type: 'talk-request',
    });
    expect(first.mock.sent.at(-1)).toMatchObject({
      active: true,
      type: 'talk-state',
    });
    second.mock.message({
      connectionId: secondReady.connectionId,
      type: 'talk-request',
    });
    expect(second.mock.sent.at(-1)).toMatchObject({
      active: false,
      reason: 'busy',
      type: 'talk-state',
    });
    first.mock.close();
    second.mock.message({
      connectionId: secondReady.connectionId,
      type: 'talk-request',
    });
    expect(second.mock.sent.at(-1)).toMatchObject({
      active: true,
      type: 'talk-state',
    });
    hub.close();
  });

  it('denies talk without a camera talk grant', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice('camera', 'public-camera', device.ws);
    hub.connectViewer('camera', 'public-camera', viewer.ws, false);
    const ready = viewer.mock.sent.at(-1) as { connectionId: string };

    viewer.mock.message({
      connectionId: ready.connectionId,
      type: 'talk-request',
    });

    expect(viewer.mock.sent.at(-1)).toMatchObject({
      active: false,
      reason: 'not_allowed',
      type: 'talk-state',
    });
    expect(device.mock.sent.at(-1)).not.toMatchObject({ type: 'talk-state' });
    hub.close();
  });

  it('sends source-enforced listen permission to both peers', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice('camera', 'public-camera', device.ws);

    hub.connectViewer(
      'camera',
      'public-camera',
      viewer.ws,
      false,
      'viewer-session',
      false,
    );

    expect(device.mock.sent.at(-1)).toMatchObject({
      canListen: false,
      type: 'viewer-ready',
    });
    expect(viewer.mock.sent.at(-1)).toMatchObject({
      canListen: false,
      canTalk: false,
      type: 'ready',
    });
    hub.close();
  });

  it('replaces a stale producer and preserves deterministic presence events', () => {
    const states: Array<[string, string, boolean]> = [];
    const hub = new SignalingHub(
      () => [],
      () => [],
      30_000,
      'all',
      () => undefined,
      (householdId, cameraId, connected) =>
        states.push([householdId, cameraId, connected]),
    );
    const stale = socket();
    const replacement = socket();
    hub.connectDevice(
      'internal-camera',
      'public-camera',
      stale.ws,
      'household',
    );
    hub.connectDevice(
      'internal-camera',
      'public-camera',
      replacement.ws,
      'household',
    );

    expect(stale.mock.readyState).toBe(3);
    expect(hub.cameraStatus('public-camera').producerConnected).toBe(true);
    stale.mock.emit('close');
    expect(hub.cameraStatus('public-camera').producerConnected).toBe(true);
    replacement.mock.close();
    expect(states).toEqual([
      ['household', 'public-camera', true],
      ['household', 'public-camera', true],
      ['household', 'public-camera', false],
    ]);
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

  it('disconnects one managed camera without affecting a sibling', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const firstDevice = socket();
    const firstViewer = socket();
    const siblingDevice = socket();
    const siblingViewer = socket();
    hub.connectDevice('first', 'public-first', firstDevice.ws);
    hub.connectDevice('sibling', 'public-sibling', siblingDevice.ws);
    hub.connectViewer('first', 'public-first', firstViewer.ws);
    hub.connectViewer('sibling', 'public-sibling', siblingViewer.ws);
    const siblingReady = siblingViewer.mock.sent.at(-1) as {
      connectionId: string;
    };
    siblingDevice.mock.message({
      connectionId: siblingReady.connectionId,
      type: 'connected',
    });

    hub.disconnectCamera('public-first', 'camera_disabled');

    expect(firstDevice.mock.readyState).toBe(3);
    expect(firstViewer.mock.sent.at(-1)).toMatchObject({
      code: 'camera_disabled',
      type: 'peer-left',
    });
    expect(hub.cameraStatus('public-first')).toMatchObject({
      producerConnected: false,
      viewerCount: 0,
    });
    expect(hub.cameraStatus('public-sibling')).toMatchObject({
      producerConnected: true,
      viewerCount: 1,
    });
    hub.close();
  });

  it('requests an in-device source switch over the existing producer socket', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    hub.connectDevice('internal-rear', 'public-rear', device.ws);

    expect(
      hub.requestSourceSwitch(['public-rear', 'public-front'], 'public-front'),
    ).toBe(true);
    expect(device.mock.sent.at(-1)).toEqual({
      cameraId: 'public-front',
      type: 'switch-source',
    });
    expect(hub.requestSourceSwitch(['offline'], 'public-front')).toBe(false);
    hub.close();
  });

  it('notifies the connected camera device when its source list changes', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    hub.connectDevice('internal-rear', 'public-rear', device.ws);

    expect(hub.notifySourcesChanged(['public-front', 'public-rear'])).toBe(
      true,
    );
    expect(device.mock.sent.at(-1)).toEqual({ type: 'sources-changed' });
    expect(hub.notifySourcesChanged(['offline'])).toBe(false);
    hub.close();
  });

  it('sends recording requests only through the server-owned device channel', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    hub.connectDevice('internal-camera', 'public-camera', device.ws);

    expect(hub.requestRecording('public-camera', 'recording-one')).toBe(true);
    expect(device.mock.sent.at(-1)).toEqual({
      recordingId: 'recording-one',
      type: 'recording-request',
    });
    expect(hub.requestRecording('offline-camera', 'recording-two')).toBe(false);
    hub.close();
  });

  it('ends viewers immediately in privacy mode but keeps device control', () => {
    const hub = new SignalingHub(
      () => [],
      () => [],
    );
    const device = socket();
    const viewer = socket();
    hub.connectDevice('internal-camera', 'public-camera', device.ws);
    hub.connectViewer('internal-camera', 'public-camera', viewer.ws);

    hub.setPrivacyMode('public-camera', true);

    expect(hub.activeSessionCount).toBe(0);
    expect(viewer.mock.sent.at(-1)).toMatchObject({
      code: 'privacy_enabled',
      type: 'peer-left',
    });
    expect(device.mock.readyState).toBe(1);
    expect(device.mock.sent.at(-1)).toEqual({
      enabled: true,
      type: 'privacy-mode',
    });
    hub.setPrivacyMode('public-camera', false);
    expect(device.mock.sent.at(-1)).toEqual({
      enabled: false,
      type: 'privacy-mode',
    });
    hub.close();
  });

  it('refuses a ninth viewer of one camera with a distinct close code (V20)', () => {
    const servers = [{ urls: ['stun:localhost:3478'] }];
    const hub = new SignalingHub(
      () => servers,
      () => servers,
    );
    hub.connectDevice('camera-1', 'public-camera-1', socket().ws);
    for (let index = 0; index < 8; index += 1)
      expect(
        hub.connectViewer('camera-1', 'public-camera-1', socket().ws),
      ).toBe(true);
    const ninth = socket();
    expect(hub.connectViewer('camera-1', 'public-camera-1', ninth.ws)).toBe(
      false,
    );
    expect(ninth.mock.sent.at(-1)).toEqual({
      code: 'camera_busy',
      type: 'error',
    });
    // 4003 means "authorization lost" to the apps; a full camera must not look like that.
    expect(ninth.mock.closeCodes).toEqual([4008]);
    hub.close();
  });

  it('closes a peer that floods signaling messages, and one that sends an oversized message (V20)', () => {
    const servers = [{ urls: ['stun:localhost:3478'] }];
    const hub = new SignalingHub(
      () => servers,
      () => servers,
    );
    hub.connectDevice('camera-1', 'public-camera-1', socket().ws);
    const viewer = socket();
    hub.connectViewer('camera-1', 'public-camera-1', viewer.ws);
    const ready = viewer.mock.sent.at(-1) as { connectionId: string };
    for (let index = 0; index < 200; index += 1)
      viewer.mock.message({
        candidate: { candidate: `candidate:${index}` },
        connectionId: ready.connectionId,
        type: 'ice',
      });
    expect(viewer.mock.closeCodes).toEqual([]);
    viewer.mock.message({
      candidate: { candidate: 'one too many' },
      connectionId: ready.connectionId,
      type: 'ice',
    });
    expect(viewer.mock.closeCodes).toEqual([1008]);

    const large = socket();
    hub.connectViewer('camera-1', 'public-camera-1', large.ws);
    large.mock.emit('message', Buffer.alloc(200_000, 97));
    expect(large.mock.closeCodes).toEqual([1009]);
    hub.close();
  });
});
