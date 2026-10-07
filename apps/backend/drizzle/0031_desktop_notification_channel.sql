-- Desktop alerts (ADR 0083): the desktop app receives the same alerts as Web
-- Push and FCM, delivered over its authenticated realtime connection.
ALTER TABLE "notification_subscriptions" DROP CONSTRAINT "notification_subscriptions_channel_valid";
--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_channel_valid" CHECK ("notification_subscriptions"."channel" in ('fcm', 'web_push', 'desktop'));
