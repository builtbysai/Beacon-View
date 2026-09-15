ALTER TABLE "cameras" ADD COLUMN "paired_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_paired_by_user_id_users_id_fk" FOREIGN KEY ("paired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
