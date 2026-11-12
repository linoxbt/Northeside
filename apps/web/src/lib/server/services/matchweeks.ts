import "server-only";
import { currentMatchweek, matchweekWithFixtures } from "@northeside/core";
import { getCtx } from "../ctx";

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

export async function getCurrent() {
  const ctx = getCtx();
  const mw = await currentMatchweek(ctx);
  if (!mw) return null;
  const data = await matchweekWithFixtures(ctx, mw.id);
  return data ? publicMatchweek(data) : null;
}

export async function getById(id: number) {
  const data = await matchweekWithFixtures(getCtx(), id);
  return data ? publicMatchweek(data) : null;
}
