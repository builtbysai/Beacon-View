ALTER TABLE notification_events
  DROP CONSTRAINT notification_events_deduplication_key_key;
CREATE UNIQUE INDEX notification_events_user_deduplication_unique
  ON notification_events (user_id, deduplication_key);

ALTER TABLE notification_presence_state ADD COLUMN user_id uuid;
UPDATE notification_presence_state nps
SET user_id = COALESCE(
  (SELECT ne.user_id FROM notification_events ne WHERE ne.id = nps.offline_event_id),
  (SELECT h.owner_id
   FROM cameras d JOIN households h ON h.id = d.household_id
   WHERE d.id = nps.device_id)
);
ALTER TABLE notification_presence_state
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT notification_presence_state_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  DROP CONSTRAINT notification_presence_state_pkey,
  ADD CONSTRAINT notification_presence_state_pkey PRIMARY KEY (user_id, device_id);
