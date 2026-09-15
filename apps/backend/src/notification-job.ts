import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from './config.js';
import { NotificationSender } from './notification-delivery.js';
import type { MilestoneStore } from './store.js';

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
      const now = new Date();
      await store.scanNotificationPresence(
        now,
        config.NOTIFICATION_OFFLINE_GRACE_SECONDS ?? 120,
      );
      const deliveries = await store.claimNotificationDeliveries(now);
      for (const delivery of deliveries) {
        const outcome = await sender.send(delivery);
        if (outcome.success) {
          await store.markNotificationDelivered(
            delivery.id,
            delivery.subscriptionId,
            new Date(),
          );
        } else {
          await store.markNotificationFailed(
            delivery.id,
            delivery.subscriptionId,
            new Date(),
            outcome.permanent,
            outcome.retryAfterMs,
          );
        }
      }
      if (deliveries.length > 0)
        logger.info(
          { deliveryCount: deliveries.length },
          'Processed notification delivery batch',
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
