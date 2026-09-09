ALTER TABLE "camera_sources"
  ADD COLUMN "motion_quiet_hours_start_minute" integer,
  ADD COLUMN "motion_quiet_hours_end_minute" integer,
  ADD COLUMN "motion_quiet_hours_time_zone" text,
  ADD CONSTRAINT "camera_motion_quiet_hours_complete" CHECK (
    ("motion_quiet_hours_start_minute" IS NULL) = ("motion_quiet_hours_end_minute" IS NULL)
    AND ("motion_quiet_hours_start_minute" IS NULL) = ("motion_quiet_hours_time_zone" IS NULL)
  ),
  ADD CONSTRAINT "camera_motion_quiet_hours_minutes_valid" CHECK (
    ("motion_quiet_hours_start_minute" IS NULL OR "motion_quiet_hours_start_minute" BETWEEN 0 AND 1439)
    AND ("motion_quiet_hours_end_minute" IS NULL OR "motion_quiet_hours_end_minute" BETWEEN 0 AND 1439)
    AND ("motion_quiet_hours_start_minute" IS NULL OR "motion_quiet_hours_start_minute" <> "motion_quiet_hours_end_minute")
  );
