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
 * The connection URL to use. Supabase's session pooler (*.pooler.supabase.com:5432) gives every
 * client its own server connection from a pool of 15, which serverless instances exhaust within
 * minutes (production outage, 27 Nov 2026: EMAXCONNSESSION). Its transaction pooler (same host,
 * port 6543) shares connections between transactions, so the session URL is switched to it.
 * DATABASE_SESSION_MODE=1 keeps session mode (e.g. for a tool that needs session features).
 */
export function poolerUrl(url: string, env: Record<string, string | undefined> = process.env): string {
  if (env.DATABASE_SESSION_MODE === "1") return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pooler.supabase.com") && (u.port === "5432" || u.port === "")) {
      u.port = "6543";
      return u.toString();
    }
  } catch {
    // Not a URL we can parse (e.g. a socket path): use it as is.
  }
  return url;
}

/**
 * One small pooled client per process. Serverless instances are many and short-lived: each keeps at
 * most DATABASE_POOL_MAX (default 2) connections and closes idle ones after 20 s, so warm instances
 * do not hold the database's connections. Prepared statements are off (the pooler does not support them).
 */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("Missing env DATABASE_URL");
  if (cached?.url === url) return cached.db;
  const client = postgres(poolerUrl(url), {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 2),
    idle_timeout: 20,
    max_lifetime: 60 * 10,
    connect_timeout: 10,
  });
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
