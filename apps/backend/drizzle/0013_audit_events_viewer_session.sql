ALTER TABLE "audit_events" ADD COLUMN "viewer_session_id" uuid;
--> statement-breakpoint
CREATE INDEX "audit_events_viewer_session_idx" ON "audit_events" USING btree ("viewer_session_id");
