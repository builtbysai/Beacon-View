import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { HouseholdEventHub } from '../src/household-events.js';

class MockSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: unknown[] = [];

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }
}

describe('HouseholdEventHub', () => {
  it('isolates realtime camera events by household', () => {
    const hub = new HouseholdEventHub();
    const owner = new MockSocket();
    const otherHousehold = new MockSocket();
    hub.subscribe('household-a', owner as unknown as WebSocket);
    hub.subscribe('household-b', otherHousehold as unknown as WebSocket);

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
});
