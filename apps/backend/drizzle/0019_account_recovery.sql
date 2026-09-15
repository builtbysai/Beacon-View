ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Google already verifies the email address before Beacon accepts the
-- sign-in (see the `email_verified === true` check in authentication-routes.ts),
-- so existing Google accounts are backfilled as verified from account creation.
UPDATE users SET email_verified_at = created_at WHERE google_subject IS NOT NULL;

CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX email_verification_tokens_token_hash_unique ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_user_pending_idx ON email_verification_tokens (user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX password_reset_tokens_token_hash_unique ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_tokens_user_pending_idx ON password_reset_tokens (user_id, expires_at)
  WHERE consumed_at IS NULL;
