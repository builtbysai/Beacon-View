ALTER TABLE "browser_sessions"
  ADD COLUMN "reauthenticated_at" timestamptz NOT NULL DEFAULT now();
