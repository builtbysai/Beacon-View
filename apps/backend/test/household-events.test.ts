import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { HouseholdEventHub } from '../src/household-events.js';

class MockSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: unknown[] = [];
  closeCode: number | undefined;
  closeReason: string | undefined;

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close');
  }
}

describe('HouseholdEventHub', () => {
  it('isolates realtime camera events by household', () => {
    const hub = new HouseholdEventHub();
    const owner = new MockSocket();
    const otherHousehold = new MockSocket();
    hub.subscribe('household-a', 'session-a', owner as unknown as WebSocket);
    hub.subscribe(
      'household-b',
      'session-b',
      otherHousehold as unknown as WebSocket,
    );

    hub.publish('household-a', {
      cameraId: 'public-camera-id',
      pairingState: 'completed',
      type: 'camera-paired',
    });

    expect(owner.sent.at(-1)).toEqual({
      cameraId: 'public-camera-id',
      pairingState: 'completed',
      type: 'camera-paired',
    });
    expect(otherHousehold.sent).toHaveLength(1);
    expect(JSON.stringify(owner.sent)).not.toContain('household-a');
    hub.close();
  });

  it('closes exactly the revoked session, leaving other sessions in the same household connected', () => {
    const hub = new HouseholdEventHub();
    const revoked = new MockSocket();
    const stillSignedIn = new MockSocket();
    hub.subscribe(
      'household-a',
      'session-revoked',
      revoked as unknown as WebSocket,
    );
    hub.subscribe(
      'household-a',
      'session-kept',
      stillSignedIn as unknown as WebSocket,
    );

    hub.closeSession('session-revoked');

    expect(revoked.readyState).toBe(3);
    expect(revoked.closeCode).toBe(4001);
    expect(stillSignedIn.readyState).toBe(1);

    // The household subscription is still live for the kept session.
    hub.publish('household-a', { type: 'device-management-changed' });
    expect(stillSignedIn.sent.at(-1)).toEqual({
      type: 'device-management-changed',
    });
    hub.close();
  });

  it('closes every session in a household at once on account deletion', () => {
    const hub = new HouseholdEventHub();
    const first = new MockSocket();
    const second = new MockSocket();
    hub.subscribe('household-a', 'session-1', first as unknown as WebSocket);
    hub.subscribe('household-a', 'session-2', second as unknown as WebSocket);

    hub.closeHousehold('household-a');

    expect(first.readyState).toBe(3);
    expect(second.readyState).toBe(3);
    expect(first.closeCode).toBe(4001);
    hub.close();
  });

  it('sends desktop alerts only to the subscribing session', () => {
    const hub = new HouseholdEventHub();
    const desktop = new MockSocket();
    const otherSession = new MockSocket();
    hub.subscribe('household-a', 'session-a', desktop as unknown as WebSocket);
    hub.subscribe(
      'household-a',
      'session-b',
      otherSession as unknown as WebSocket,
    );
    const alert = {
      category: 'motion',
      eventId: 'event-1',
      route: '/activity',
      type: 'notification' as const,
    };
    expect(hub.sendToSession('session-a', alert)).toBe(1);
    expect(desktop.sent).toContainEqual(alert);
    expect(otherSession.sent).not.toContainEqual(alert);
    desktop.close();
    expect(hub.sendToSession('session-a', alert)).toBe(0);
  });
});
