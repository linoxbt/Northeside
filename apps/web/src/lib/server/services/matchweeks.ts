import { RULES_V2, rulesVersion } from "@northeside/scoring";
import "server-only";
import { currentMatchweek, matchweekWithFixtures, oddsFor } from "@northeside/core";
import { schema } from "@northeside/db";
import { desc } from "drizzle-orm";
import { getCtx } from "../ctx";

const CURRENT_RULES_VERSION = RULES_V2.version;

export function publicMatchweek(data: NonNullable<Awaited<ReturnType<typeof matchweekWithFixtures>>>) {
  const { matchweek: mw, fixtures } = data;
  const ctx = getCtx();
  return {
    id: mw.id,
    season: mw.season,
    status: mw.status,
    lockTime: mw.lockTime.toISOString(),
    locked: ctx.now() >= mw.lockTime,
    fixturesRoot: mw.fixturesRoot,
    /** Scoring rules version (2 = Banker and beat-the-crowd bonus). */
    rules: mw.scoringRulesHash ? rulesVersion(mw.scoringRulesHash) : CURRENT_RULES_VERSION,
    createTx: mw.createTx,
    resultsRoot: mw.resultsRoot,
    disputeEnds: mw.disputeEnds?.toISOString() ?? null,
    finalizedAt: mw.finalizedAt?.toISOString() ?? null,
    fixtures: fixtures.map((f) => ({
      index: f.idx,
      home: f.home,
      away: f.away,
      kickoff: f.kickoff.toISOString(),
      status: f.status,
      homeGoals: f.homeGoals,
      awayGoals: f.awayGoals,
    })),
  };
}
export type PublicMatchweek = ReturnType<typeof publicMatchweek>;

/** Adds the odds model's expected goals to each fixture (null before the first fit). */
async function withOdds(pm: PublicMatchweek) {
  const odds = await oddsFor(getCtx(), pm.id).catch(() => null);
  return {
    ...pm,
    fixtures: pm.fixtures.map((f) => {
      const o = odds?.fixtures.find((x) => x.index === f.index);
      return { ...f, xg: o ? { home: o.home, away: o.away } : null };
    }),
  };
}

export async function getCurrent() {
  const ctx = getCtx();
  const mw = await currentMatchweek(ctx);
  if (!mw) return null;
  const data = await matchweekWithFixtures(ctx, mw.id);
  return data ? withOdds(publicMatchweek(data)) : null;
}

export async function getById(id: number) {
  const data = await matchweekWithFixtures(getCtx(), id);
  return data ? withOdds(publicMatchweek(data)) : null;
}

export interface MatchweekTab {
  id: number;
  status: string;
  lockTime: string;
}

/** Matchweeks for the sportsbook switcher: the latest played, the open one, and the next drafts. */
export async function listMatchweeks(): Promise<MatchweekTab[]> {
  const { db } = getCtx();
  const rows = await db
    .select({ id: schema.matchweeks.id, status: schema.matchweeks.status, lockTime: schema.matchweeks.lockTime })
    .from(schema.matchweeks)
    .orderBy(desc(schema.matchweeks.id))
    .limit(12);
  return rows.map((r) => ({ id: r.id, status: r.status, lockTime: r.lockTime.toISOString() })).sort((a, b) => a.id - b.id);
}
