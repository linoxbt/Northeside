#!/usr/bin/env python3
# Usage (from packages/db): python3 scripts/apply-via-management-api.py <project-ref>
# Needs a Supabase access token on Authorization (in this cloud environment the proxy injects it).
# Use it where raw Postgres connections are blocked; otherwise `pnpm --filter @northeside/db migrate`.
#
# Applies drizzle migrations through the Supabase Management API (HTTPS) and records them in
# drizzle.__drizzle_migrations exactly as drizzle's migrator would (sha256 of the file, journal "when").
import hashlib, json, sys, urllib.request
REF = sys.argv[1]
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"

def q(sql):
    req = urllib.request.Request(URL, data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": "Bearer proxy-injected", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or "null")

q('CREATE SCHEMA IF NOT EXISTS "drizzle"; CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);')
done = {row["hash"] for row in (q('select hash from "drizzle"."__drizzle_migrations"') or [])}
journal = json.load(open("drizzle/meta/_journal.json"))
for e in journal["entries"]:
    sql = open(f"drizzle/{e['tag']}.sql").read()
    h = hashlib.sha256(sql.encode()).hexdigest()
    if h in done:
        print("skip", e["tag"]); continue
    stmts = [s for s in sql.split("--> statement-breakpoint") if s.strip()]
    body = "BEGIN;\n" + ";\n".join(s.strip().rstrip(";") for s in stmts) + f';\nINSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (\'{h}\', {e["when"]});\nCOMMIT;'
    q(body)
    print("applied", e["tag"])
