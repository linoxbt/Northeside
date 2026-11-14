import { schema } from "@northeside/db";
import { breakdown, rulesVersion, type FixtureBreakdown } from "@northeside/scoring";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { CoreContext } from "./context";
import { fixtureRows, provisional, sideFor } from "./live";
import { displayName } from "./queries";

/** Codes are short and unguessable: 10 characters of a 32-letter alphabet (50 bits). */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newCode() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export class H2HError extends Error {
  constructor(
    readonly code: "not_found" | "locked" | "own_challenge" | "taken" | "too_many",
    message: string,
  ) {
    super(message);
  }
}

/** Create a challenge link for an open matchweek. */
export async function createChallenge(ctx: CoreContext, userId: string, matchweekId: number) {
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, matchweekId));
  if (!mw || mw.status !== "open") throw new H2HError("not_found", "This matchweek is not open");
  if (ctx.now() >= mw.lockTime) throw new H2HError("locked", "This matchweek is locked");
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: count() })
    .from(schema.h2hChallenges)
    .where(and(eq(schema.h2hChallenges.challengerUserId, userId), eq(schema.h2hChallenges.matchweekId, matchweekId)));
  if (n >= 20) throw new H2HError("too_many", "You have made 20 challenges for this matchweek");
  const [row] = await ctx.db.insert(schema.h2hChallenges).values({ code: newCode(), matchweekId, challengerUserId: userId }).returning();
  return { code: row!.code, matchweekId };
}

/** Accept a challenge before lock. Accepting twice is a no-op; someone else's accepted challenge is taken. */
export async function acceptChallenge(ctx: CoreContext, code: string, userId: string) {
  const [c] = await ctx.db.select().from(schema.h2hChallenges).where(eq(schema.h2hChallenges.code, code));
  if (!c) throw new H2HError("not_found", "No such challenge");
  if (c.challengerUserId === userId) throw new H2HError("own_challenge", "This is your own challenge; send the link to a friend");
  if (c.opponentUserId === userId) return { code, accepted: true };
  if (c.opponentUserId) throw new H2HError("taken", "Someone else already accepted this challenge");
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, c.matchweekId));
  if (!mw || ctx.now() >= mw.lockTime) throw new H2HError("locked", "This matchweek is locked; challenges close at the first kickoff");
  const taken = await ctx.db
    .update(schema.h2hChallenges)
    .set({ opponentUserId: userId, acceptedAt: new Date() })
    // Only a still-open challenge can be taken: two friends accepting at once cannot both win the race.
    .where(and(eq(schema.h2hChallenges.id, c.id), isNull(schema.h2hChallenges.opponentUserId)))
    .returning({ id: schema.h2hChallenges.id });
  if (taken.length === 0) throw new H2HError("taken", "Someone else already accepted this challenge");
  return { code, accepted: true };
}


export interface H2HSide {
  name: string;
  sealed: boolean;
  points: number | null;
  exactScores: number | null;
  picks: { home: number[]; away: number[]; banker: number | null } | null;
  fixtures: FixtureBreakdown[];
}

export interface H2HView {
  code: string;
  matchweekId: number;
  locked: boolean;
  final: boolean;
  viewer: "challenger" | "opponent" | "guest";
  fixtures: { index: number; home: string; away: string; state: string; homeGoals: number | null; awayGoals: number | null }[];
  challenger: H2HSide;
  opponent: H2HSide | null;
}

/** A challenge as either player (or a guest) sees it. Picks show only after lock. */
export async function challengeView(ctx: CoreContext, code: string, viewerUserId?: string | null): Promise<H2HView | null> {
  const [c] = await ctx.db.select().from(schema.h2hChallenges).where(eq(schema.h2hChallenges.code, code));
  if (!c) return null;
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, c.matchweekId));
  if (!mw) return null;
  const fixtures = await fixtureRows(ctx, mw.id);
  const locked = ctx.now() >= mw.lockTime;
  const ids = [c.challengerUserId, ...(c.opponentUserId ? [c.opponentUserId] : [])];
  const users = await ctx.db.select().from(schema.users).where(inArray(schema.users.id, ids));
  const sealedRows = await ctx.db
    .select({ userId: schema.predictions.userId, txStatus: schema.predictions.txStatus, wallet: schema.predictions.wallet })
    .from(schema.predictions)
    .where(and(eq(schema.predictions.matchweekId, mw.id), inArray(schema.predictions.userId, ids)));

  const version = rulesVersion(mw.scoringRulesHash);
  const live = locked ? await provisional(ctx, mw.id, version, fixtures) : null;

  const side = (userId: string): H2HSide => {
    const u = users.find((x) => x.id === userId);
    const anyWallet = sealedRows.find((r) => r.userId === userId)?.wallet ?? "0x0000000000000000000000000000000000000000";
    const name = u && !u.deletedAt ? displayName(u, anyWallet) : "Deleted player";
    const sealed = sealedRows.some((r) => r.userId === userId && r.txStatus === "confirmed");
    const s = live ? sideFor(live.scored, userId) : undefined;
    return {
      name,
      sealed,
      points: s ? s.points : null,
      exactScores: s ? s.exactScores : null,
      picks: s ? { home: s.home, away: s.away, banker: s.banker === undefined || s.banker === 255 ? null : s.banker } : null,
      fixtures: s && live ? breakdown(version, s, live.entries, live.results) : [],
    };
  };

  return {
    code,
    matchweekId: mw.id,
    locked,
    final: mw.status === "finalized",
    viewer: viewerUserId === c.challengerUserId ? "challenger" : viewerUserId && viewerUserId === c.opponentUserId ? "opponent" : "guest",
    fixtures: fixtures.map((f) => {
      const lf = live?.view.find((x) => x.index === f.idx);
      return { index: f.idx, home: f.home, away: f.away, state: lf?.state ?? "scheduled", homeGoals: lf?.home ?? null, awayGoals: lf?.away ?? null };
    }),
    challenger: side(c.challengerUserId),
    opponent: c.opponentUserId ? side(c.opponentUserId) : null,
  };
}
