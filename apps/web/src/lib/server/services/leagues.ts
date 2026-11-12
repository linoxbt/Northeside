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
