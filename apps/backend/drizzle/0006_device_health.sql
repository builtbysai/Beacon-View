ALTER TABLE "cameras"
  ADD COLUMN "battery_percent" integer,
  ADD COLUMN "battery_charging" boolean,
  ADD COLUMN "health_reported_at" timestamp with time zone,
  ADD CONSTRAINT "cameras_battery_percent_valid" CHECK ("battery_percent" IS NULL OR "battery_percent" BETWEEN 0 AND 100);
