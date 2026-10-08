-- A Drive connection Google stopped accepting (expired or revoked refresh
-- token) is kept and marked, so the app can say "reconnect" rather than
-- "connect" (ADR 0086). Expired rows count as no connection everywhere else.
ALTER TABLE "google_drive_connections" ADD COLUMN "expired_at" timestamp with time zone;
