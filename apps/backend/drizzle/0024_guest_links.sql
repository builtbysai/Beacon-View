CREATE TABLE "guest_link_cameras" (
	"guest_link_id" uuid NOT NULL,
	"camera_source_id" uuid NOT NULL,
	CONSTRAINT "guest_link_cameras_guest_link_id_camera_source_id_pk" PRIMARY KEY("guest_link_id","camera_source_id")
);
--> statement-breakpoint
CREATE TABLE "guest_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"can_listen" boolean DEFAULT false NOT NULL,
	"can_talk" boolean DEFAULT false NOT NULL,
	"can_flip" boolean DEFAULT false NOT NULL,
	"can_pause" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_link_cameras" ADD CONSTRAINT "guest_link_cameras_guest_link_id_guest_links_id_fk" FOREIGN KEY ("guest_link_id") REFERENCES "public"."guest_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_link_cameras" ADD CONSTRAINT "guest_link_cameras_camera_source_id_camera_sources_id_fk" FOREIGN KEY ("camera_source_id") REFERENCES "public"."camera_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_links_token_hash_unique" ON "guest_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_links_household_idx" ON "guest_links" USING btree ("household_id");