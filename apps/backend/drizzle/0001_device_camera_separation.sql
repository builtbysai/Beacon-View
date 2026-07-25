ALTER TABLE "cameras" DROP CONSTRAINT IF EXISTS "cameras_platform_android";
ALTER TABLE "cameras" DROP CONSTRAINT IF EXISTS "cameras_platform_check";
ALTER TABLE "cameras"
  ADD COLUMN IF NOT EXISTS "device_type" text DEFAULT 'phone' NOT NULL,
  ADD COLUMN IF NOT EXISTS "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "software_version" text,
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz;
ALTER TABLE "cameras"
  ADD CONSTRAINT "cameras_platform_supported"
  CHECK ("platform" IN ('android', 'browser'));

CREATE TABLE "camera_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "cameras"("id") ON DELETE CASCADE,
  "public_camera_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "display_name" text NOT NULL,
  "source_key" text NOT NULL,
  "facing" text DEFAULT 'unknown' NOT NULL,
  "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "camera_sources_public_id_unique" UNIQUE ("public_camera_id"),
  CONSTRAINT "camera_sources_device_source_unique" UNIQUE ("device_id", "source_key"),
  CONSTRAINT "camera_sources_facing_supported"
    CHECK ("facing" IN ('front', 'rear', 'external', 'unknown'))
);
CREATE INDEX "camera_sources_device_idx" ON "camera_sources" ("device_id");

-- Every existing paired Android record becomes a device with one default
-- source. Device IDs, installation IDs, credentials, and pairing history stay
-- unchanged, so no phone needs to pair again.
INSERT INTO "camera_sources"
  ("device_id", "display_name", "source_key", "facing", "last_seen_at",
   "created_at", "updated_at")
SELECT
  "id",
  "name",
  'legacy-default',
  'rear',
  "last_seen_at",
  "created_at",
  "updated_at"
FROM "cameras"
ON CONFLICT ("device_id", "source_key") DO NOTHING;
