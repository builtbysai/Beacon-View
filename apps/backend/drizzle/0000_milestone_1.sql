CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE ("email")
);

CREATE TABLE "households" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "households_owner_unique" UNIQUE ("owner_id")
);

CREATE TABLE "browser_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "csrf_hash" text NOT NULL,
  "idle_expires_at" timestamptz NOT NULL,
  "absolute_expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "browser_sessions_user_idx" ON "browser_sessions" ("user_id");

CREATE TABLE "cameras" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "public_device_id" uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  "installation_id" uuid NOT NULL UNIQUE,
  "name" text NOT NULL,
  "platform" text DEFAULT 'android' NOT NULL CHECK ("platform" = 'android'),
  "last_seen_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "cameras_household_idx" ON "cameras" ("household_id");

CREATE TABLE "device_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "camera_id" uuid NOT NULL UNIQUE REFERENCES "cameras"("id") ON DELETE CASCADE,
  "credential_hash" text NOT NULL UNIQUE,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "pairing_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz,
  "camera_id" uuid REFERENCES "cameras"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "pairing_codes_single_terminal_state"
    CHECK (NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL))
);
CREATE INDEX "pairing_codes_household_idx" ON "pairing_codes" ("household_id");

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "household_id" uuid REFERENCES "households"("id") ON DELETE SET NULL,
  "camera_id" uuid REFERENCES "cameras"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "success" boolean NOT NULL,
  "ip_address" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" ("occurred_at");
