import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export * as schema from "./schema";
export { FieldCrypto, safeEqual } from "./crypto";
export type Db = PostgresJsDatabase<typeof schema>;
/** Any Drizzle Postgres database over this schema (postgres-js in production, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: { url: string; db: Db; client: postgres.Sql } | undefined;

/**
 * One pooled client per process. On Vercel, use Supabase's transaction pooler URL (port 6543);
 * prepared statements are off because the pooler does not support them.
 */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("Missing env DATABASE_URL");
  if (cached?.url === url) return cached.db;
  const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
  const db = drizzle(client, { schema });
  cached = { url, db, client };
  return db;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.client.end({ timeout: 5 });
    cached = undefined;
  }
}
