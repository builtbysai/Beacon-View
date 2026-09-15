ALTER TABLE "household_invitations" ADD COLUMN "default_can_listen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD COLUMN "default_can_talk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD COLUMN "default_can_flip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD COLUMN "default_can_pause" boolean DEFAULT false NOT NULL;
