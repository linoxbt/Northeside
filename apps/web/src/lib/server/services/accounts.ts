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
export async function joinLeague(userId: string, slug: string, source: string | null) {
  const { db } = getCtx();
  const [league] = await db.select().from(schema.leagues).where(sql`lower(${schema.leagues.slug}) = ${slug.toLowerCase()}`);
  if (!league) throw new HttpError(404, "league_not_found", "League not found");
  await db.insert(schema.leagueMembers).values({ leagueId: league.id, userId, source }).onConflictDoNothing();
  await db
    .update(schema.users)
    .set({ attributedLeagueId: league.id, attributionSource: source })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.attributedLeagueId)));
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
