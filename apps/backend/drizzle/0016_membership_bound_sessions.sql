ALTER TABLE browser_sessions
  ADD COLUMN household_id uuid;

UPDATE browser_sessions s
SET household_id = h.id
FROM households h
WHERE h.owner_id = s.user_id AND s.household_id IS NULL;

ALTER TABLE browser_sessions
  ALTER COLUMN household_id SET NOT NULL,
  ADD CONSTRAINT browser_sessions_household_fk
    FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

CREATE INDEX browser_sessions_household_idx
  ON browser_sessions (household_id, user_id)
  WHERE revoked_at IS NULL;
