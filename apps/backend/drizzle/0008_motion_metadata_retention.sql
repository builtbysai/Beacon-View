ALTER TABLE "households"
  ADD COLUMN "motion_retention_days" integer NOT NULL DEFAULT 30;
--> statement-breakpoint
ALTER TABLE "households"
  ADD CONSTRAINT "households_motion_retention_valid"
  CHECK ("motion_retention_days" IN (1, 7, 30, 90));
