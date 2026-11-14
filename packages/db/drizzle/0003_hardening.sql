CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_events" ADD COLUMN "block_hash" text;--> statement-breakpoint
ALTER TABLE "drips" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "pending_payload_enc" text;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "pending_commitment" text;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "pending_tx_hash" text;--> statement-breakpoint
ALTER TABLE "reward_roots" ADD COLUMN "status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "drips_email_uq" ON "drips" USING btree ("email_hash");--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
