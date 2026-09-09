ALTER TABLE "cameras"
  ADD COLUMN IF NOT EXISTS "privacy_mode" boolean DEFAULT false NOT NULL;
