ALTER TABLE "cameras"
  ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "camera_sources"
  ADD COLUMN IF NOT EXISTS "removed_at" timestamp with time zone;
