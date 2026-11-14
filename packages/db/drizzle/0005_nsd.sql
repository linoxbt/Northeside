CREATE TABLE "nsd_leaves" (
	"matchweek_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"proof" jsonb NOT NULL,
	"claim_tx" text,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "nsd_leaves_matchweek_id_wallet_pk" PRIMARY KEY("matchweek_id","wallet")
);
--> statement-breakpoint
CREATE TABLE "nsd_roots" (
	"matchweek_id" integer PRIMARY KEY NOT NULL,
	"root" text NOT NULL,
	"total" numeric(78, 0) NOT NULL,
	"report_uri" text NOT NULL,
	"tree" jsonb NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nsd_roots" ADD CONSTRAINT "nsd_roots_matchweek_id_matchweeks_id_fk" FOREIGN KEY ("matchweek_id") REFERENCES "public"."matchweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nsd_leaves_wallet_idx" ON "nsd_leaves" USING btree ("wallet");--> statement-breakpoint
ALTER TABLE "nsd_roots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nsd_leaves" ENABLE ROW LEVEL SECURITY;