CREATE TABLE "used_person_hashes" (
	"person_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "used_person_hashes" ADD CONSTRAINT "used_person_hashes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One person hash per account. Guarded so a database that somehow holds a duplicate keeps migrating
-- (the app also checks used_person_hashes before linking); the operator is told in the job log.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "identities" GROUP BY "person_hash" HAVING count(*) > 1) THEN
    RAISE NOTICE 'identities has duplicate person_hash values: unique index not created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "identities_person_hash_unique" ON "identities" USING btree ("person_hash");
  END IF;
END $$;--> statement-breakpoint
INSERT INTO "used_person_hashes" ("person_hash", "user_id") SELECT DISTINCT ON ("person_hash") "person_hash", "user_id" FROM "identities" ORDER BY "person_hash", "created_at" ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Same as every other table (0001_rls): no policies, so the anon and authenticated roles see nothing.
ALTER TABLE "used_person_hashes" ENABLE ROW LEVEL SECURITY;