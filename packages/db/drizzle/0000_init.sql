CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" integer PRIMARY KEY NOT NULL,
	"sponsor_name" text NOT NULL,
	"sponsor" text NOT NULL,
	"gross_amount" numeric(78, 0) NOT NULL,
	"fee_bps" integer NOT NULL,
	"budget" numeric(78, 0) NOT NULL,
	"rate_per_player" numeric(78, 0) NOT NULL,
	"cap_per_host" numeric(78, 0) NOT NULL,
	"first_matchweek" integer NOT NULL,
	"last_matchweek" integer NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"leagues" jsonb,
	"leagues_hash" text NOT NULL,
	"terms_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_sponsor" boolean DEFAULT true NOT NULL,
	"create_tx" text,
	"fund_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"address" text NOT NULL,
	"event_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"block_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "countable_players" (
	"campaign_id" integer NOT NULL,
	"matchweek_id" integer NOT NULL,
	"person_hash" text NOT NULL,
	"host" text NOT NULL,
	"league_slug" text NOT NULL,
	CONSTRAINT "countable_players_person_hash_matchweek_id_campaign_id_pk" PRIMARY KEY("person_hash","matchweek_id","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "drips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"device_hash" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"matchweek_id" integer NOT NULL,
	"idx" smallint NOT NULL,
	"external_id" integer NOT NULL,
	"home" text NOT NULL,
	"away" text NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"home_goals" smallint,
	"away_goals" smallint,
	CONSTRAINT "fixtures_matchweek_id_idx_pk" PRIMARY KEY("matchweek_id","idx")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"route" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"person_ref_enc" text NOT NULL,
	"person_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mode" text DEFAULT 'B' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"run_key" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_members_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"privacy" text DEFAULT 'public' NOT NULL,
	"host_user_id" uuid NOT NULL,
	"host_wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchweeks" (
	"id" integer PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lock_time" timestamp with time zone NOT NULL,
	"fixtures_root" text,
	"fixtures_tree" jsonb,
	"scoring_rules_hash" text,
	"create_tx" text,
	"results_root" text,
	"results_tree" jsonb,
	"results_check" jsonb,
	"evidence_uri" text,
	"override_reason" text,
	"dispute_ends" timestamp with time zone,
	"reveals_root" text,
	"reveals_tree" jsonb,
	"scores_root" text,
	"scores_tree" jsonb,
	"finalize_tx" text,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"telegram_chat_id" text,
	"web_push" jsonb,
	"email_opt_in" boolean DEFAULT false NOT NULL,
	"remind_lock" boolean DEFAULT true NOT NULL,
	"remind_results" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"matchweek_id" integer NOT NULL,
	"draft" jsonb,
	"payload_enc" text,
	"commitment" text,
	"version" integer DEFAULT 0 NOT NULL,
	"tx_hash" text,
	"tx_status" text DEFAULT 'none' NOT NULL,
	"sealed_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"reveal_payload" jsonb,
	"reveal_valid" boolean,
	"reveal_error" text,
	"points" integer,
	"exact_scores" integer,
	"rank" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "reward_leaves" (
	"campaign_id" integer NOT NULL,
	"matchweek_id" integer NOT NULL,
	"host" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"countable_players" integer NOT NULL,
	"proof" jsonb NOT NULL,
	"claim_tx" text,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "reward_leaves_campaign_id_matchweek_id_host_pk" PRIMARY KEY("campaign_id","matchweek_id","host")
);
--> statement-breakpoint
CREATE TABLE "reward_roots" (
	"campaign_id" integer NOT NULL,
	"matchweek_id" integer NOT NULL,
	"root" text NOT NULL,
	"total" numeric(78, 0) NOT NULL,
	"report_uri" text NOT NULL,
	"tree" jsonb NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_roots_campaign_id_matchweek_id_pk" PRIMARY KEY("campaign_id","matchweek_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_did" text,
	"email_hash" text,
	"email_enc" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"qie_id" text,
	"qie_id_resolved" boolean DEFAULT false NOT NULL,
	"adult_confirmed_at" timestamp with time zone,
	"attributed_league_id" uuid,
	"attribution_source" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_did_unique" UNIQUE("privy_did"),
	CONSTRAINT "users_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
CREATE TABLE "wallet_persons" (
	"wallet" text PRIMARY KEY NOT NULL,
	"person_hash" text NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drips" ADD CONSTRAINT "drips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_matchweek_id_matchweeks_id_fk" FOREIGN KEY ("matchweek_id") REFERENCES "public"."matchweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_matchweek_id_matchweeks_id_fk" FOREIGN KEY ("matchweek_id") REFERENCES "public"."matchweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_roots" ADD CONSTRAINT "reward_roots_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_roots" ADD CONSTRAINT "reward_roots_matchweek_id_matchweeks_id_fk" FOREIGN KEY ("matchweek_id") REFERENCES "public"."matchweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chain_events_name_idx" ON "chain_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "chain_events_block_idx" ON "chain_events" USING btree ("block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "drips_user_uq" ON "drips" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drips_wallet_uq" ON "drips" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "drips_device_uq" ON "drips" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "drips_created_idx" ON "drips" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fixtures_external_uq" ON "fixtures" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_uq" ON "job_runs" USING btree ("job","run_key");--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "league_members_user_idx" ON "league_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_slug_uq" ON "leagues" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "leagues_host_idx" ON "leagues" USING btree ("host_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_wallet_mw_uq" ON "predictions" USING btree ("wallet","matchweek_id");--> statement-breakpoint
CREATE INDEX "predictions_mw_idx" ON "predictions" USING btree ("matchweek_id");--> statement-breakpoint
CREATE INDEX "predictions_user_idx" ON "predictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reward_leaves_host_idx" ON "reward_leaves" USING btree ("host");--> statement-breakpoint
CREATE INDEX "wallet_persons_person_idx" ON "wallet_persons" USING btree ("person_hash");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");