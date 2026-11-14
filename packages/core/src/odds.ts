import { schema } from "@northeside/db";
import { TheSportsDbClient, type MatchResult as ProviderResult } from "@northeside/football";
import { PROMOTED_PRIOR, expectedGoals, fitRatings, key, type MatchResult } from "@northeside/odds";
import { asc, eq, inArray } from "drizzle-orm";
import type { CoreContext } from "./context";

/** Expected goals per fixture for one matchweek, frozen at lock. */
export interface MatchweekOdds {
  model: "dixon-coles-v1";
  fittedAt: string;
  matches: number;
  fixtures: { index: number; home: number; away: number }[];
}

const ROUNDS_PER_SEASON = 38;
const seasonLabel = (start: number) => `${start}-${start + 1}`;

async function getSetting<T>(ctx: CoreContext, k: string): Promise<T | null> {
  const [row] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, k));
  return (row?.value as T | undefined) ?? null;
}
async function setSetting(ctx: CoreContext, k: string, value: unknown) {
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: k, value: value as object })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: value as object, updatedAt: new Date() } });
}

/**
 * Results history for the model: last season and this season's finished rounds, from TheSportsDB
 * (free key, one request per round). A round is cached for good once all its games have scores,
 * so after the first run only the latest round is fetched.
 */
export async function loadHistory(ctx: CoreContext, uptoRound: number, opts: { client?: TheSportsDbClient; pauseMs?: number } = {}): Promise<MatchResult[]> {
  const client = opts.client ?? new TheSportsDbClient({ apiKey: process.env.THESPORTSDB_API_KEY, baseUrl: process.env.THESPORTSDB_BASE_URL });
  const pause = opts.pauseMs ?? 2_200; // free tier: 30 requests a minute
  const wanted: [number, number][] = [];
  for (let r = 1; r <= ROUNDS_PER_SEASON; r++) wanted.push([ctx.season - 1, r]);
  for (let r = 1; r < uptoRound; r++) wanted.push([ctx.season, r]);
  const out: MatchResult[] = [];
  let fetched = 0;
  for (const [season, round] of wanted) {
    const k = `history:${seasonLabel(season)}:${round}`;
    let games = await getSetting<MatchResult[]>(ctx, k);
    if (!games) {
      if (fetched > 0) await new Promise((r) => setTimeout(r, pause));
      fetched++;
      const rows: ProviderResult[] = await client.results(round, season).catch(() => []);
      const done = rows.filter((g) => g.status === "played" && g.homeGoals !== null && g.awayGoals !== null);
      games = done.map((g) => ({ home: g.home, away: g.away, homeGoals: g.homeGoals!, awayGoals: g.awayGoals!, date: new Date(g.kickoff * 1000).toISOString() }));
      // Cache only complete rounds (all games played or void), so a half-played round is refetched.
      if (rows.length > 0 && rows.every((g) => g.status !== "pending")) await setSetting(ctx, k, games);
    }
    out.push(...games);
  }
  return out;
}

/**
 * Fit the model and store expected goals for every matchweek that has not locked yet. Promoted
 * teams (not in last season's results) start from a below-average prior.
 */
export async function computeOdds(ctx: CoreContext, opts: { history?: MatchResult[] } = {}) {
  const now = ctx.now();
  const upcoming = (await ctx.db.select().from(schema.matchweeks).where(inArray(schema.matchweeks.status, ["draft", "open"])).orderBy(asc(schema.matchweeks.id))).filter(
    (m) => m.lockTime > now,
  );
  if (upcoming.length === 0) return { skipped: "no upcoming matchweek" };
  const history = opts.history ?? (await loadHistory(ctx, upcoming[0]!.id));
  if (history.length < 50) throw new Error(`odds: only ${history.length} results in the history; not fitting`);
  const lastSeasonTeams = new Set(history.filter((m) => Date.parse(m.date) < Date.UTC(ctx.season, 6, 1)).flatMap((m) => [key(m.home), key(m.away)]));
  const priorFor = (k: string) => (lastSeasonTeams.has(k) ? { attack: 0, defence: 0 } : PROMOTED_PRIOR);
  const ratings = fitRatings(history, { asOf: now, priorFor });
  const done = [];
  for (const mw of upcoming) {
    const fixtures = await ctx.db.select().from(schema.fixtures).where(eq(schema.fixtures.matchweekId, mw.id)).orderBy(asc(schema.fixtures.idx));
    const value: MatchweekOdds = {
      model: "dixon-coles-v1",
      fittedAt: now.toISOString(),
      matches: ratings.matches,
      fixtures: fixtures.map((f) => {
        const xg = expectedGoals(ratings, f.home, f.away, priorFor);
        return { index: f.idx, home: +xg.home.toFixed(4), away: +xg.away.toFixed(4) };
      }),
    };
    await setSetting(ctx, `odds:${mw.id}`, value);
    done.push({ matchweekId: mw.id, fixtures: value.fixtures.length });
  }
  return { fittedOn: ratings.matches, homeAdvantage: +ratings.home.toFixed(3), matchweeks: done };
}

/** Stored expected goals for a matchweek (null before the first fit). */
export async function oddsFor(ctx: CoreContext, matchweekId: number): Promise<MatchweekOdds | null> {
  return getSetting<MatchweekOdds>(ctx, `odds:${matchweekId}`);
}
