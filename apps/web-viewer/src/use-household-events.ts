import { useEffect } from 'react';

import { eventsUrl } from './app-navigation';

export interface HouseholdEvent {
  cameraId?: string;
  /** Desktop alerts (type 'notification', ADR 0083) carry these. */
  category?: string;
  eventId?: string;
  route?: string;
  type: string;
}

interface HouseholdEventOptions {
  enabled: boolean;
  onEvent: (event: HouseholdEvent) => void;
  onSessionEnded: () => void;
  /** The session is still fully valid -- something it depends on just
   * changed (camera grants, active household). Refetch and carry on;
   * this must never sign the person out. */
  onRefreshNeeded?: () => void;
}

export function useHouseholdEvents({
  enabled,
  onEvent,
  onSessionEnded,
  onRefreshNeeded,
}: HouseholdEventOptions): void {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retry = 0;
    let refreshOnSubscribe = false;

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        retry = 0;
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as HouseholdEvent;
          if (event.type === 'subscribed' && refreshOnSubscribe) {
            refreshOnSubscribe = false;
            onRefreshNeeded?.();
          }
          if (typeof event.type === 'string') onEvent(event);
        } catch {
          // Ignore malformed server events. A later valid event or inventory
          // refresh restores state without taking down the event channel.
        }
      };
      socket.onclose = (event) => {
        if (!active) return;
        // 4001: the session token itself was actually revoked (password
        // reset, account deletion, explicitly signed out elsewhere) -- this
        // is the only close code that should ever sign the person out.
        if (event.code === 4001) {
          onSessionEnded();
          return;
        }
        // 4002: the session is still valid, but something it depends on
        // changed (camera grants, active household) -- refetch and
        // reconnect right away rather than waiting out the backoff below.
        if (event.code === 4002) {
          onRefreshNeeded?.();
          refreshOnSubscribe = false;
          retry = 0;
          reconnectTimer = window.setTimeout(connect, 200);
          return;
        }
        // 4003 ("Connection rejected"/"Authorization lost") covers both "not
        // signed in at all" and "role dropped below admin" -- the latter
        // leaves the session valid, so this must not sign the person out
        // either. If this tab's own state hasn't already disabled this
        // hook (see `enabled` above), just keep retrying with backoff.
        if (event.code !== 4003) refreshOnSubscribe = true;
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
  }, [enabled, onEvent, onSessionEnded, onRefreshNeeded]);
}
