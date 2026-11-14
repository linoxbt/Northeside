import "server-only";
import { schema } from "@northeside/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getCtx } from "../ctx";
import { HttpError } from "../api";

export async function walletsOf(userId: string) {
  return getCtx().db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId));
}

export async function userById(userId: string) {
  const [u] = await getCtx().db.select().from(schema.users).where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));
  return u ?? null;
}

/** FR-19: the first host link a player joins through is their attributed league for the season. */
/** FR-34 on the server: playing features need the 18+ confirmation, not just the UI gate (audit G9). */
export async function requireAdult(userId: string) {
  const { db } = getCtx();
  const [u] = await db.select({ at: schema.users.adultConfirmedAt }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.at) throw new HttpError(403, "adult_required", "Confirm you are 18 or older first");
}

export async function joinLeague(userId: string, slug: string, source: string | null) {
  const { db } = getCtx();
  await requireAdult(userId);
  const [league] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`);
  if (!league) throw new HttpError(404, "league_not_found", "League not found");
  await db.insert(schema.leagueMembers).values({ leagueId: league.id, userId, source }).onConflictDoNothing();
  await db
    .update(schema.users)
    .set({ attributedLeagueId: league.id, attributionSource: source })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.attributedLeagueId)));
  return league;
}

/** FR-18: leave a league. Attribution stays: it records the first host link for the season (FR-19). */
export async function leaveLeague(userId: string, slug: string) {
  const { db } = getCtx();
  const [league] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`);
  if (!league) throw new HttpError(404, "league_not_found", "League not found");
  if (league.hostUserId === userId) throw new HttpError(400, "host_cannot_leave", "Hosts cannot leave their own league");
  await db.delete(schema.leagueMembers).where(and(eq(schema.leagueMembers.leagueId, league.id), eq(schema.leagueMembers.userId, userId)));
  return league;
}

export async function isVerifiedUser(userId: string) {
  const { db } = getCtx();
  const rows = await db
    .select({ w: schema.walletPersons.wallet })
    .from(schema.walletPersons)
    .innerJoin(schema.wallets, eq(schema.wallets.address, schema.walletPersons.wallet))
    .where(eq(schema.wallets.userId, userId));
  return rows.length > 0;
}
