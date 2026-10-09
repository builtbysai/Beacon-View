-- Motion zones (ADR 0092): cells of a 16 x 16 grid over the upright picture
-- where movement is ignored (a busy street, a ceiling fan). Only cell
-- numbers are stored, never an image.
ALTER TABLE "camera_sources" ADD COLUMN "motion_ignored_zones" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "camera_sources" ADD CONSTRAINT "camera_sources_motion_ignored_zones_array" CHECK (jsonb_typeof("camera_sources"."motion_ignored_zones") = 'array');
