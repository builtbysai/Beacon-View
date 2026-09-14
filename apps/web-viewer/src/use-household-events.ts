import { useEffect } from 'react';

import { eventsUrl } from './app-navigation';

export interface HouseholdEvent {
  cameraId?: string;
  type: string;
}

interface HouseholdEventOptions {
  enabled: boolean;
  onEvent: (event: HouseholdEvent) => void;
  onSessionEnded: () => void;
}

export function useHouseholdEvents({
  enabled,
  onEvent,
  onSessionEnded,
}: HouseholdEventOptions): void {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retry = 0;

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        retry = 0;
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as HouseholdEvent;
          if (typeof event.type === 'string') onEvent(event);
        } catch {
          // Ignore malformed server events. A later valid event or inventory
          // refresh restores state without taking down the event channel.
        }
      };
      socket.onclose = (event) => {
        if (!active) return;
        if (event.code === 4001 || event.code === 4003) {
          onSessionEnded();
          return;
        }
        const delay = Math.min(1_000 * 2 ** retry, 15_000);
        retry += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled, onEvent, onSessionEnded]);
}
