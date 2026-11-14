CREATE TABLE "h2h_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"matchweek_id" integer NOT NULL,
	"challenger_user_id" uuid NOT NULL,
	"opponent_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "h2h_challenges_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "h2h_challenges" ADD CONSTRAINT "h2h_challenges_matchweek_id_matchweeks_id_fk" FOREIGN KEY ("matchweek_id") REFERENCES "public"."matchweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "h2h_challenges" ADD CONSTRAINT "h2h_challenges_challenger_user_id_users_id_fk" FOREIGN KEY ("challenger_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "h2h_challenges" ADD CONSTRAINT "h2h_challenges_opponent_user_id_users_id_fk" FOREIGN KEY ("opponent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "h2h_challenger_idx" ON "h2h_challenges" USING btree ("challenger_user_id");--> statement-breakpoint
CREATE INDEX "h2h_opponent_idx" ON "h2h_challenges" USING btree ("opponent_user_id");--> statement-breakpoint
ALTER TABLE "h2h_challenges" ENABLE ROW LEVEL SECURITY;