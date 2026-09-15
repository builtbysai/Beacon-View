ALTER TABLE "camera_grants" ADD COLUMN "can_flip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "camera_grants" ADD COLUMN "can_pause" boolean DEFAULT false NOT NULL;
