-- Supabase exposes tables through PostgREST with the anon key. RLS with no policies denies
-- every anon/authenticated request; the server connects as the table owner and is unaffected.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chain_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "countable_players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "drips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixtures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "indexer_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "league_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leagues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matchweeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "predictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reward_leaves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reward_roots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallet_persons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
