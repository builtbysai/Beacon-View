-- Home and Away modes (ADR 0094).
CREATE TABLE "household_modes" (
  "household_id" uuid PRIMARY KEY NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "mode" text DEFAULT 'away' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "schedule_mode" text,
  "settings" jsonb NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "household_modes_mode_valid" CHECK ("mode" IN ('home', 'away')),
  CONSTRAINT "household_modes_source_valid" CHECK ("source" IN ('manual', 'schedule')),
  CONSTRAINT "household_modes_schedule_mode_valid" CHECK ("schedule_mode" IS NULL OR "schedule_mode" IN ('home', 'away'))
);
--> statement-breakpoint
ALTER TABLE "cameras" ADD COLUMN "paused_by_mode" boolean DEFAULT false NOT NULL;
