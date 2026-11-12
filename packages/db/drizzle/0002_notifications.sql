CREATE TABLE "notifications_sent" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"matchweek_id" integer NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_sent_user_id_kind_matchweek_id_pk" PRIMARY KEY("user_id","kind","matchweek_id")
);
--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ENABLE ROW LEVEL SECURITY;
