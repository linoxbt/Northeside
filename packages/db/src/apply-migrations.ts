import { sql } from "drizzle-orm";
import type { Database } from "./index";
import { MIGRATIONS } from "./migrations.generated";

/**
 * Apply pending migrations exactly as drizzle's migrator records them (sha256 of the file in
 * drizzle.__drizzle_migrations), so migrations applied earlier by drizzle-kit or the Management
 * API script are recognised and skipped. Each migration runs in its own transaction.
 */
export async function applyMigrations(db: Database): Promise<{ applied: string[]; skipped: string[] }> {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "drizzle"`));
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`),
  );
  const rows = (await db.execute(sql.raw(`SELECT hash FROM "drizzle"."__drizzle_migrations"`))) as unknown as
    | { hash: string }[]
    | { rows: { hash: string }[] };
  const done = new Set((Array.isArray(rows) ? rows : rows.rows).map((r) => r.hash));
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.hash)) {
      skipped.push(m.tag);
      continue;
    }
    const statements = m.sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    await db.transaction(async (tx) => {
      for (const st of statements) await tx.execute(sql.raw(st));
      await tx.execute(sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${m.hash}, ${m.when})`);
    });
    applied.push(m.tag);
  }
  return { applied, skipped };
}
