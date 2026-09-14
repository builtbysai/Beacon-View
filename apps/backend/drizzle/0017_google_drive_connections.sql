CREATE TABLE google_drive_connections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_ciphertext bytea NOT NULL,
  refresh_token_iv bytea NOT NULL,
  provider_email text,
  scopes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
