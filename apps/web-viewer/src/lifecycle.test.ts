import { describe, expect, it } from 'vitest';

import { deviceLifecycle, nextPairingState } from './lifecycle';

describe('lifecycle state machines', () => {
  it('distinguishes offline, idle, and streaming cameras', () => {
    expect(deviceLifecycle(false)).toBe('offline');
    expect(deviceLifecycle(true)).toBe('idle');
    expect(deviceLifecycle(true, 2)).toBe('streaming');
  });

  it('does not leave terminal pairing states', () => {
    expect(nextPairingState('pending', 'code-created')).toBe('waiting');
    expect(nextPairingState('waiting', 'completed')).toBe('completed');
    expect(nextPairingState('completed', 'code-created')).toBe('completed');
  });
});
