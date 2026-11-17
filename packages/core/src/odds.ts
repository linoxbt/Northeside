import { schema } from "@northeside/db";
import { TheSportsDbClient, type MatchResult as ProviderResult } from "@northeside/football";
import { PROMOTED_PRIOR, expectedGoals, fitRatings, key, probabilityOf, scoreGrid, type MatchResult } from "@northeside/odds";
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
 * The results already cached by loadHistory (last season and this season before `uptoRound`), with
 * no network calls: for read paths such as recent form.
 */
export async function cachedHistory(ctx: CoreContext, uptoRound: number): Promise<MatchResult[]> {
  const keys: string[] = [];
  for (let r = 1; r <= ROUNDS_PER_SEASON; r++) keys.push(`history:${seasonLabel(ctx.season - 1)}:${r}`);
  for (let r = 1; r < uptoRound; r++) keys.push(`history:${seasonLabel(ctx.season)}:${r}`);
  const rows = await ctx.db.select().from(schema.appSettings).where(inArray(schema.appSettings.key, keys));
  return rows.flatMap((r) => (r.value as MatchResult[] | null) ?? []);
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
    // Keep every fit (30 days at one fit per 6 hours) for the chance-over-time chart.
    const hist = (await getSetting<HistoryEntry[]>(ctx, `oddshist:${mw.id}`)) ?? [];
    await setSetting(ctx, `oddshist:${mw.id}`, [...hist, { t: value.fittedAt, fixtures: value.fixtures }].slice(-120));
    done.push({ matchweekId: mw.id, fixtures: value.fixtures.length });
  }
  return { fittedOn: ratings.matches, homeAdvantage: +ratings.home.toFixed(3), matchweeks: done };
}

/** Stored expected goals for a matchweek (null before the first fit). */
export async function oddsFor(ctx: CoreContext, matchweekId: number): Promise<MatchweekOdds | null> {
  return getSetting<MatchweekOdds>(ctx, `odds:${matchweekId}`);
}

interface HistoryEntry {
  t: string;
  fixtures: MatchweekOdds["fixtures"];
}

/** Every stored fit for one game, oldest first (falls back to the current fit). */
export async function fitsFor(ctx: CoreContext, matchweekId: number, index: number): Promise<{ t: string; home: number; away: number }[]> {
  let hist = await getSetting<HistoryEntry[]>(ctx, `oddshist:${matchweekId}`);
  if (!hist?.length) {
    const cur = await oddsFor(ctx, matchweekId);
    hist = cur ? [{ t: cur.fittedAt, fixtures: cur.fixtures }] : [];
  }
  return hist.flatMap((h) => {
    const f = h.fixtures.find((x) => x.index === index);
    return f ? [{ t: h.t, home: f.home, away: f.away }] : [];
  });
}

export type Outcome = "home" | "draw" | "away";
export interface ChancePoint {
  t: string;
  home: number;
  draw: number;
  away: number;
}

/** 1X2 chances from expected goals (Dixon-Coles grid). */
export function resultChances(xg: { home: number; away: number }) {
  const g = scoreGrid(xg.home, xg.away);
  return { home: probabilityOf(g, (h, a) => h > a), draw: probabilityOf(g, (h, a) => h === a), away: probabilityOf(g, (h, a) => h < a) };
}

/**
 * Chance over time for one game, as on the match page: the model's latest fit at each moment,
 * blended with the picks sealed by then (each pick counts 1 against k for the model) once at
 * least minCrowd have sealed. Seal times are rounded up to the hour; the series ends at `end`.
 */
export function chanceSeries(
  fits: { t: string; home: number; away: number }[],
  seals: { t: Date; outcome: Outcome }[],
  opts: { end: Date; minCrowd: number; k?: number; maxPoints?: number },
): ChancePoint[] {
  const k = opts.k ?? 30;
  const end = opts.end.getTime();
  const fitList = fits.map((f) => ({ t: Date.parse(f.t), p: resultChances(f) })).filter((f) => f.t <= end).sort((a, b) => a.t - b.t);
  if (fitList.length === 0) return [];
  const hour = 3_600_000;
  const sealList = seals.map((s) => ({ t: Math.ceil(s.t.getTime() / hour) * hour, outcome: s.outcome })).sort((a, b) => a.t - b.t);
  const start = fitList[0]!.t;
  const times = [...new Set([...fitList.map((f) => f.t), ...sealList.map((s) => s.t), end])].filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  const points = times.map((t) => {
    let fit = fitList[0]!;
    for (const f of fitList) if (f.t <= t) fit = f;
    const c = { home: 0, draw: 0, away: 0 };
    let n = 0;
    for (const s of sealList) if (s.t <= t) {
      c[s.outcome]++;
      n++;
    }
    const blend = n >= opts.minCrowd;
    const p = (o: Outcome) => +(blend ? (k * fit.p[o] + c[o]) / (k + n) : fit.p[o]).toFixed(4);
    return { t: new Date(t).toISOString(), home: p("home"), draw: p("draw"), away: p("away") };
  });
  // Thin evenly to maxPoints, always keeping the first and last.
  const max = opts.maxPoints ?? 200;
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}
