import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from './config.js';
import { NotificationSender } from './notification-delivery.js';
import type {
  NotificationDelivery,
  NotificationDeliveryOutcome,
} from './notification-types.js';
import type { MilestoneStore } from './store.js';

export interface NotificationDeliverySender {
  send(delivery: NotificationDelivery): Promise<NotificationDeliveryOutcome>;
}

/** One sweep: claim due deliveries, send each, and record the outcome.
 * Counts are derived only from `channel` and the already-public
 * `safePayload.category` -- never `providerMaterial` or payload content --
 * so the summary log line is safe to ship to any log aggregator. */
export async function runNotificationSweep(
  store: MilestoneStore,
  sender: NotificationDeliverySender,
  logger: FastifyBaseLogger,
  now: Date,
  offlineGraceSeconds: number,
): Promise<void> {
  await store.scanNotificationPresence(now, offlineGraceSeconds);
  const deliveries = await store.claimNotificationDeliveries(now);
  let delivered = 0;
  let failedPermanent = 0;
  let failedRetryable = 0;
  const byChannel: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const delivery of deliveries) {
    const outcome = await sender.send(delivery);
    byChannel[delivery.channel] = (byChannel[delivery.channel] ?? 0) + 1;
    const category = delivery.safePayload.category ?? 'unknown';
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    if (outcome.success) {
      delivered += 1;
      await store.markNotificationDelivered(
        delivery.id,
        delivery.subscriptionId,
        now,
      );
    } else {
      if (outcome.permanent) failedPermanent += 1;
      else failedRetryable += 1;
      await store.markNotificationFailed(
        delivery.id,
        delivery.subscriptionId,
        now,
        outcome.permanent,
        outcome.retryAfterMs,
      );
    }
  }
  if (deliveries.length > 0)
    logger.info(
      {
        byCategory,
        byChannel,
        delivered,
        deliveryCount: deliveries.length,
        failedPermanent,
        failedRetryable,
      },
      'Processed notification delivery batch',
    );
}

export function startNotificationJob(
  store: MilestoneStore,
  config: AppConfig,
  logger: FastifyBaseLogger,
  intervalMs = 30_000,
): () => void {
  if (!store.notificationsConfigured()) return () => undefined;
  const sender = new NotificationSender(config);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runNotificationSweep(
        store,
        sender,
        logger,
        new Date(),
        config.NOTIFICATION_OFFLINE_GRACE_SECONDS ?? 120,
      );
    } catch (error) {
      logger.error({ err: error }, 'Notification transport sweep failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
