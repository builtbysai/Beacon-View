-- Camera use cases (ADR 0084): a named preset over existing settings.
ALTER TABLE "camera_sources" ADD COLUMN "use_case" text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE "camera_sources" ADD CONSTRAINT "camera_sources_use_case_valid" CHECK ("camera_sources"."use_case" in ('general', 'security', 'baby', 'doorbell'));
