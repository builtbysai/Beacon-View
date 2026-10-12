type DeviceLifecycle =
  'offline' | 'online' | 'streaming' | 'idle' | 'updating' | 'error';

export type PairingLifecycle =
  'pending' | 'waiting' | 'accepted' | 'completed' | 'expired' | 'cancelled';

export function deviceLifecycle(
  online: boolean,
  activeViewers = 0,
): DeviceLifecycle {
  if (!online) return 'offline';
  return activeViewers > 0 ? 'streaming' : 'idle';
}

export function nextPairingState(
  current: PairingLifecycle,
  event: 'code-created' | 'accepted' | 'completed' | 'expired' | 'cancelled',
): PairingLifecycle {
  const transitions: Record<
    PairingLifecycle,
    Partial<Record<typeof event, PairingLifecycle>>
  > = {
    accepted: { completed: 'completed' },
    cancelled: {},
    completed: {},
    expired: {},
    pending: { 'code-created': 'waiting', cancelled: 'cancelled' },
    waiting: {
      accepted: 'accepted',
      cancelled: 'cancelled',
      completed: 'completed',
      expired: 'expired',
    },
  };
  return transitions[current][event] ?? current;
}
