import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useHouseholdEvents } from './use-household-events';

class EventSocket {
  static instances: EventSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor() {
    EventSocket.instances.push(this);
  }

  close() {}

  subscribe() {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: 'subscribed' }) });
  }

  disconnect(code: number) {
    this.onclose?.({ code });
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  EventSocket.instances = [];
});

it('refreshes inventory and history after a lost event connection recovers', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', EventSocket);
  const onRefreshNeeded = vi.fn();
  renderHook(() =>
    useHouseholdEvents({
      enabled: true,
      onEvent: vi.fn(),
      onRefreshNeeded,
      onSessionEnded: vi.fn(),
    }),
  );

  act(() => EventSocket.instances[0]!.subscribe());
  expect(onRefreshNeeded).not.toHaveBeenCalled();
  act(() => EventSocket.instances[0]!.disconnect(1006));
  act(() => {
    vi.advanceTimersByTime(1_300); // jittered: 0.75 to 1.25 seconds
  });
  act(() => EventSocket.instances[1]!.subscribe());
  expect(onRefreshNeeded).toHaveBeenCalledTimes(1);
});

it('refreshes once for a deliberate grant change, before reconnecting', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', EventSocket);
  const onRefreshNeeded = vi.fn();
  renderHook(() =>
    useHouseholdEvents({
      enabled: true,
      onEvent: vi.fn(),
      onRefreshNeeded,
      onSessionEnded: vi.fn(),
    }),
  );

  act(() => EventSocket.instances[0]!.subscribe());
  act(() => EventSocket.instances[0]!.disconnect(4002));
  expect(onRefreshNeeded).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  act(() => EventSocket.instances[1]!.subscribe());
  expect(onRefreshNeeded).toHaveBeenCalledTimes(1);
});
