ALTER TABLE "recordings" ADD COLUMN "thumbnail_provider_file_id" text;
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "thumbnail_byte_size" integer;
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "thumbnail_checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "thumbnail_mime_type" text;
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "thumbnail_encryption_iv" bytea;
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "thumbnail_encryption_data_key_ciphertext" bytea;
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "thumbnail_encryption_data_key_iv" bytea;
--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_thumbnail_provider_file_unique" ON "recordings" USING btree ("thumbnail_provider_file_id");
--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_thumbnail_size_valid" CHECK ("recordings"."thumbnail_byte_size" is null or "recordings"."thumbnail_byte_size" > 0);
--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_thumbnail_mime_type_valid" CHECK ("recordings"."thumbnail_mime_type" is null or "recordings"."thumbnail_mime_type" in ('image/jpeg', 'image/webp'));
