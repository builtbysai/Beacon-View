import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

import type { AppConfig } from './config.js';
import { hashSecret } from './security.js';
import type { MilestoneStore } from './store.js';

export type HouseholdEvent =
  | {
      cameraId: string;
      pairingState: 'completed';
      type: 'camera-paired';
    }
  | {
      cameraId: string;
      type: 'camera-presence-changed';
    }
  | {
      cameraId?: string;
      type: 'device-credential-revoked';
    }
  | {
      type: 'device-management-changed';
    };

export class HouseholdEventHub {
  readonly #subscribers = new Map<string, Set<WebSocket>>();

  subscribe(householdId: string, socket: WebSocket): void {
    const household = this.#subscribers.get(householdId) ?? new Set();
    household.add(socket);
    this.#subscribers.set(householdId, household);
    socket.once('close', () => {
      household.delete(socket);
      if (household.size === 0) this.#subscribers.delete(householdId);
    });
    socket.send(JSON.stringify({ type: 'subscribed' }));
  }

  publish(householdId: string, event: HouseholdEvent): void {
    for (const socket of this.#subscribers.get(householdId) ?? []) {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    }
  }

  close(): void {
    for (const subscribers of this.#subscribers.values()) {
      for (const socket of subscribers) {
        socket.close(1001, 'Server shutdown');
      }
    }
    this.#subscribers.clear();
  }
}

export function registerHouseholdEvents(
  app: FastifyInstance,
  config: AppConfig,
  store: MilestoneStore,
): HouseholdEventHub {
  const hub = new HouseholdEventHub();
  void app.register((eventApp) => {
    eventApp.addHook('onClose', () => hub.close());
    eventApp.get(
      '/api/events',
      { websocket: true },
      async (socket, request) => {
        if (request.headers.origin !== config.WEB_ORIGIN) {
          socket.close(4003, 'Connection rejected');
          return;
        }
        const token = request.cookies[config.SESSION_COOKIE_NAME];
        const session = token
          ? await store.findSession(hashSecret(token), new Date())
          : null;
        if (!session) {
          socket.close(4003, 'Connection rejected');
          return;
        }
        hub.subscribe(session.householdId, socket);
        const sessionHash = hashSecret(token!);
        let checking = false;
        const timer = setInterval(() => {
          if (checking) return;
          checking = true;
          void store
            .findSession(sessionHash, new Date())
            .then((current) => {
              if (!current || current.householdId !== session.householdId) {
                socket.close(4003, 'Authorization lost');
              }
            })
            .catch(() => socket.close(1011, 'Authorization check failed'))
            .finally(() => {
              checking = false;
            });
        }, 15_000);
        timer.unref();
        socket.once('close', () => clearInterval(timer));
      },
    );
  });
  return hub;
}
