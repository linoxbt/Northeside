import "server-only";
import { schema } from "@northeside/db";
import { and, eq, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCtx } from "../ctx";

/**
 * A private league's invite key (audit M7): unguessable, derived from the league id with the server
 * secret, so no extra column is needed. Joining a private league, or seeing that it exists, needs
 * it (or membership).
 */
export function leagueInviteKey(leagueId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(`league-invite:${leagueId}`).digest().subarray(0, 12).toString("base64url");
}

export function validInviteKey(leagueId: string, key: string | null | undefined): boolean {
  if (!key) return false;
  const a = Buffer.from(leagueInviteKey(leagueId));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function isMemberOf(leagueId: string, userId: string | null) {
  if (!userId) return false;
  const [m] = await getCtx()
    .db.select({ u: schema.leagueMembers.userId })
    .from(schema.leagueMembers)
    .where(and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.userId, userId)));
  return Boolean(m);
}

/** Private leagues are unlisted and their table is for members only (audit S7). */
export async function canSeeLeagueBoard(slug: string, userId: string | null) {
  const db = getCtx().db;
  const [league] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`);
  if (!league) return false;
  if (league.privacy === "public") return true;
  if (!userId) return false;
  const [m] = await db
    .select({ u: schema.leagueMembers.userId })
    .from(schema.leagueMembers)
    .where(and(eq(schema.leagueMembers.leagueId, league.id), eq(schema.leagueMembers.userId, userId)));
  return Boolean(m);
}

export async function isMember(slug: string, userId: string | null) {
  if (!userId) return false;
  const db = getCtx().db;
  const [m] = await db
    .select({ u: schema.leagueMembers.userId })
    .from(schema.leagueMembers)
    .innerJoin(schema.leagues, eq(schema.leagues.id, schema.leagueMembers.leagueId))
    .where(and(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`, eq(schema.leagueMembers.userId, userId)));
  return Boolean(m);
}

/**
 * A league's public details. A private league is returned only to its members or to someone with
 * its invite key; to anyone else it does not exist (audit M7). Members also get the invite key.
 */
export async function leagueBySlug(slug: string, viewer: { userId?: string | null; key?: string | null } = {}) {
  const db = getCtx().db;
  const [league] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`);
  if (!league) return null;
  const member = await isMemberOf(league.id, viewer.userId ?? null);
  if (league.privacy === "private" && !member && !validInviteKey(league.id, viewer.key)) return null;
  const [host] = await db.select().from(schema.users).where(eq(schema.users.id, league.hostUserId));
  const [{ members } = { members: 0 }] = await db
    .select({ members: sql<number>`count(*)::int` })
    .from(schema.leagueMembers)
    .where(eq(schema.leagueMembers.leagueId, league.id));
  return {
    slug: league.slug,
    name: league.name,
    privacy: league.privacy,
    host: (host?.qieIdResolved ? host.qieId : null) ?? host?.displayName ?? "Host",
    members: Number(members),
    /** For members of a private league: the key their invite links carry. */
    inviteKey: league.privacy === "private" && member ? leagueInviteKey(league.id) : null,
  };
}

/** Public leagues for the directory, biggest first. */
export async function leagueDirectory(limit = 48) {
  const db = getCtx().db;
  const rows = await db
    .select({
      slug: schema.leagues.slug,
      name: schema.leagues.name,
      hostName: sql<string | null>`coalesce(case when ${schema.users.qieIdResolved} then ${schema.users.qieId} end, ${schema.users.displayName})`,
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
