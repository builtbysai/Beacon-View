ALTER TABLE "device_credentials" ADD COLUMN "previous_credential_hash" text;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "device_credentials_previous_hash_unique" ON "device_credentials" USING btree ("previous_credential_hash");