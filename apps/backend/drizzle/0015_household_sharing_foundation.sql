CREATE TABLE household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_members_household_user_unique UNIQUE (household_id, user_id),
  CONSTRAINT household_members_role_valid
    CHECK (role IN ('owner', 'admin', 'viewer', 'guest')),
  CONSTRAINT household_members_status_valid
    CHECK (status IN ('active', 'revoked')),
  CONSTRAINT household_members_revocation_consistent CHECK (
    (status = 'revoked') = (revoked_at IS NOT NULL)
  ),
  CONSTRAINT household_members_guest_expiry_required CHECK (
    role <> 'guest' OR expires_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX household_members_id_household_unique
  ON household_members (id, household_id);
CREATE INDEX household_members_user_active_idx
  ON household_members (user_id, household_id)
  WHERE status = 'active';

INSERT INTO household_members (household_id, user_id, role)
SELECT id, owner_id, 'owner' FROM households
ON CONFLICT (household_id, user_id) DO NOTHING;

CREATE TABLE household_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_invitations_role_valid
    CHECK (role IN ('admin', 'viewer', 'guest')),
  CONSTRAINT household_invitations_email_normalized
    CHECK (invited_email = lower(btrim(invited_email))),
  CONSTRAINT household_invitations_terminal_state_valid
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX household_invitations_household_idx
  ON household_invitations (household_id, created_at DESC);
CREATE INDEX household_invitations_email_pending_idx
  ON household_invitations (invited_email, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE camera_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  camera_source_id uuid NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  can_listen boolean NOT NULL DEFAULT false,
  can_talk boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT camera_grants_member_household_fk
    FOREIGN KEY (member_id, household_id)
    REFERENCES household_members (id, household_id) ON DELETE CASCADE,
  CONSTRAINT camera_grants_member_camera_unique UNIQUE (member_id, camera_source_id)
);
CREATE INDEX camera_grants_household_idx ON camera_grants (household_id);

CREATE OR REPLACE FUNCTION beacon_enforce_camera_grant_household()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM camera_sources cs
    JOIN cameras d ON d.id = cs.device_id
    WHERE cs.id = NEW.camera_source_id
      AND d.household_id = NEW.household_id
  ) THEN
    RAISE EXCEPTION 'camera grant household mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER camera_grants_household_guard
BEFORE INSERT OR UPDATE ON camera_grants
FOR EACH ROW EXECUTE FUNCTION beacon_enforce_camera_grant_household();
