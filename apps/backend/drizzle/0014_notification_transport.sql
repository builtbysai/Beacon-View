CREATE TABLE notification_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  channel text NOT NULL,
  provider_ciphertext bytea NOT NULL,
  provider_iv bytea NOT NULL,
  wrapped_key bytea NOT NULL,
  wrapped_key_iv bytea NOT NULL,
  provider_fingerprint text NOT NULL,
  key_version integer NOT NULL,
  device_label text NOT NULL,
  consented_at timestamptz NOT NULL,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_subscriptions_channel_valid
    CHECK (channel IN ('fcm', 'web_push')),
  CONSTRAINT notification_subscriptions_label_length
    CHECK (char_length(device_label) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX notification_subscriptions_active_installation_unique
  ON notification_subscriptions (user_id, installation_id, channel)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX notification_subscriptions_active_provider_unique
  ON notification_subscriptions (provider_fingerprint)
  WHERE revoked_at IS NULL;
CREATE INDEX notification_subscriptions_session_idx
  ON notification_subscriptions (session_id) WHERE revoked_at IS NULL;

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  motion_enabled boolean NOT NULL DEFAULT false,
  offline_enabled boolean NOT NULL DEFAULT false,
  quiet_start_minute integer,
  quiet_end_minute integer,
  quiet_time_zone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT notification_preferences_quiet_complete CHECK (
    (quiet_start_minute IS NULL) = (quiet_end_minute IS NULL)
    AND (quiet_start_minute IS NULL) = (quiet_time_zone IS NULL)
  ),
  CONSTRAINT notification_preferences_quiet_valid CHECK (
    (quiet_start_minute IS NULL OR quiet_start_minute BETWEEN 0 AND 1439)
    AND (quiet_end_minute IS NULL OR quiet_end_minute BETWEEN 0 AND 1439)
    AND (quiet_start_minute IS NULL OR quiet_start_minute <> quiet_end_minute)
  )
);

CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES cameras(id) ON DELETE CASCADE,
  camera_source_id uuid REFERENCES camera_sources(id) ON DELETE CASCADE,
  category text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  safe_payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_events_category_valid
    CHECK (category IN ('motion', 'offline', 'recovered'))
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
  safe_payload jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  delivered_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, subscription_id),
  CONSTRAINT notification_outbox_attempt_count_valid CHECK (attempt_count BETWEEN 0 AND 5)
);
CREATE INDEX notification_outbox_pending_idx
  ON notification_outbox (next_attempt_at, id)
  WHERE delivered_at IS NULL AND terminal_at IS NULL;

CREATE TABLE notification_presence_state (
  device_id uuid PRIMARY KEY REFERENCES cameras(id) ON DELETE CASCADE,
  candidate_since timestamptz,
  offline_event_id uuid REFERENCES notification_events(id) ON DELETE SET NULL,
  offline_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
