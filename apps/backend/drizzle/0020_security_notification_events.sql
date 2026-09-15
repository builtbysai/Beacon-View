ALTER TABLE notification_events DROP CONSTRAINT notification_events_category_valid;
ALTER TABLE notification_events ADD CONSTRAINT notification_events_category_valid
  CHECK (category IN ('motion', 'offline', 'recovered', 'security'));
