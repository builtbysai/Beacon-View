CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  camera_source_id uuid NOT NULL REFERENCES camera_sources(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested',
  provider text NOT NULL DEFAULT 'google_drive',
  provider_file_id text,
  duration_ms integer,
  byte_size integer,
  checksum_sha256 text,
  mime_type text,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recordings_status_valid CHECK (status IN ('requested', 'recording', 'uploading', 'available', 'failed', 'deleting', 'deleted')),
  CONSTRAINT recordings_provider_valid CHECK (provider IN ('google_drive')),
  CONSTRAINT recordings_duration_valid CHECK (duration_ms IS NULL OR duration_ms > 0),
  CONSTRAINT recordings_size_valid CHECK (byte_size IS NULL OR byte_size > 0),
  CONSTRAINT recordings_mime_type_valid CHECK (mime_type IS NULL OR mime_type IN ('video/mp4', 'video/webm'))
);

CREATE INDEX recordings_household_created_idx ON recordings (household_id, created_at);
CREATE INDEX recordings_camera_created_idx ON recordings (camera_source_id, created_at);
CREATE UNIQUE INDEX recordings_provider_file_unique ON recordings (provider_file_id)
  WHERE provider_file_id IS NOT NULL;
