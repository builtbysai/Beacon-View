CREATE TABLE IF NOT EXISTS "motion_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "camera_source_id" uuid NOT NULL REFERENCES "camera_sources"("id") ON DELETE CASCADE,
  "event_type" text DEFAULT 'motion' NOT NULL,
  "confidence" real NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "motion_events_type_supported" CHECK ("event_type" = 'motion'),
  CONSTRAINT "motion_events_confidence_valid" CHECK
    ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE INDEX IF NOT EXISTS "motion_events_camera_occurred_idx"
  ON "motion_events" ("camera_source_id", "occurred_at");
