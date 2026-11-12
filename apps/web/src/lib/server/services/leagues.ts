import "server-only";
import { schema } from "@northeside/db";
import { eq, sql } from "drizzle-orm";
import { getCtx } from "../ctx";

export async function leagueBySlug(slug: string) {
  const db = getCtx().db;
  const [league] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`);
  if (!league) return null;
  const [host] = await db.select().from(schema.users).where(eq(schema.users.id, league.hostUserId));
  const [{ members } = { members: 0 }] = await db
    .select({ members: sql<number>`count(*)::int` })
    .from(schema.leagueMembers)
    .where(eq(schema.leagueMembers.leagueId, league.id));
  return {
    slug: league.slug,
    name: league.name,
    privacy: league.privacy,
    host: host?.qieId ?? host?.displayName ?? "Host",
    members: Number(members),
  };
}

/** Public leagues for the directory, biggest first. */
export async function leagueDirectory(limit = 48) {
  const db = getCtx().db;
  const rows = await db
    .select({
      slug: schema.leagues.slug,
      name: schema.leagues.name,
      hostName: sql<string | null>`coalesce(${schema.users.qieId}, ${schema.users.displayName})`,
      members: sql<number>`(select count(*)::int from ${schema.leagueMembers} m where m.league_id = ${schema.leagues.id})`,
      createdAt: schema.leagues.createdAt,
    })
    .from(schema.leagues)
    .innerJoin(schema.users, eq(schema.users.id, schema.leagues.hostUserId))
    .where(eq(schema.leagues.privacy, "public"))
    .orderBy(sql`(select count(*) from league_members m where m.league_id = ${schema.leagues.id}) desc`, schema.leagues.createdAt)
    .limit(limit);
  return rows.map((r) => ({ ...r, members: Number(r.members) }));
}
