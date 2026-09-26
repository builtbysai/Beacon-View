ALTER TABLE "recordings" ADD COLUMN "trigger_motion_event_id" uuid;
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_trigger_motion_event_id_motion_events_id_fk" FOREIGN KEY ("trigger_motion_event_id") REFERENCES "motion_events"("id") ON DELETE SET NULL;
CREATE INDEX "recordings_trigger_motion_event_idx" ON "recordings" ("trigger_motion_event_id");
