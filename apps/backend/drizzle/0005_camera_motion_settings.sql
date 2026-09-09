ALTER TABLE "camera_sources"
  ADD COLUMN "motion_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN "motion_sensitivity" text DEFAULT 'medium' NOT NULL,
  ADD COLUMN "motion_cooldown_seconds" integer DEFAULT 30 NOT NULL,
  ADD CONSTRAINT "camera_motion_sensitivity_valid" CHECK ("motion_sensitivity" IN ('low', 'medium', 'high')),
  ADD CONSTRAINT "camera_motion_cooldown_valid" CHECK ("motion_cooldown_seconds" IN (30, 60, 120, 300));
