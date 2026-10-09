-- Camera health alerts (ADR 0093): low battery and overheating.
ALTER TABLE "cameras" ADD COLUMN "thermal_status" text;
--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_thermal_status_valid" CHECK ("cameras"."thermal_status" IS NULL OR "cameras"."thermal_status" IN ('none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'));
--> statement-breakpoint
ALTER TABLE "notification_presence_state" ADD COLUMN "low_battery_since" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_presence_state" ADD COLUMN "overheating_since" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_events" DROP CONSTRAINT "notification_events_category_valid";
--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_category_valid" CHECK ("notification_events"."category" IN ('motion', 'offline', 'recovered', 'security', 'health'));
