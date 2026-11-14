import { sealedPayloadSchema, type SealedPayload } from "@northeside/commitments";
import { schema } from "@northeside/db";
import { breakdown, crowdCounts, rank, rulesVersion, scoreEntries, type FixtureBreakdown, type FixtureResult } from "@northeside/scoring";
import { asc, eq, inArray } from "drizzle-orm";
import type { CoreContext } from "./context";
import { payloadAad } from "./matchweek";
import { oddsFor } from "./odds";
import { displayName } from "./queries";

/** Crowd odds before lock appear only once this many wallets have sealed, so no single pick shows. */
export const MIN_CROWD = 5;

/** A small cache in app_settings: functions are stateless, and providers have rate limits. */
async function cached<T>(ctx: CoreContext, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const [row] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  const hit = row?.value as { at: number; data: T } | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fn();
  const value = { at: Date.now(), data };
  await ctx.db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
  return data;
}

async function matchweekRow(ctx: CoreContext, id: number) {
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, id));
  return mw && mw.status !== "draft" ? mw : null;
}

async function fixtureRows(ctx: CoreContext, id: number) {
  return ctx.db.select().from(schema.fixtures).where(eq(schema.fixtures.matchweekId, id)).orderBy(asc(schema.fixtures.idx));
}

/**
 * The picks the crowd is made of. Before lock: every confirmed seal's stored payload (aggregate
 * only). After lock: every valid reveal, the same set results are scored over (rules v2), one
 * entry per wallet so anyone can recompute it from the public reveals.
 */
async function crowdEntries(ctx: CoreContext, id: number, locked: boolean) {
  const rows = await ctx.db.select().from(schema.predictions).where(eq(schema.predictions.matchweekId, id));
  const out: { wallet: string; userId: string; sealedAt: Date | null; payload: SealedPayload }[] = [];
  for (const r of rows) {
    let payload: SealedPayload | null = null;
    if (locked) {
      if (r.revealValid && r.revealPayload) payload = r.revealPayload as unknown as SealedPayload;
    } else if (r.txStatus === "confirmed" && r.payloadEnc) {
      try {
        payload = sealedPayloadSchema.parse(JSON.parse(ctx.crypto.decrypt(r.payloadEnc, payloadAad(r.wallet, id))));
      } catch {
        payload = null;
      }
    }
    if (payload) out.push({ wallet: r.wallet, userId: r.userId, sealedAt: r.sealedAt, payload });
  }
  return out.sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
}

export interface CrowdView {
  matchweekId: number;
  players: number;
  shown: boolean;
  minPlayers: number;
  source: "sealed" | "revealed";
  fixtures: { index: number; home: number; draw: number; away: number }[];
}

/** Crowd odds: how many wallets call a home win, a draw or an away win in each game. */
export async function crowdView(ctx: CoreContext, id: number): Promise<CrowdView | null> {
  const mw = await matchweekRow(ctx, id);
  if (!mw) return null;
  const n = (await fixtureRows(ctx, id)).length;
  const locked = ctx.now() >= mw.lockTime;
  return cached(ctx, `crowd:${id}:${locked ? "revealed" : "sealed"}`, locked ? 60_000 : 120_000, async () => {
    const entries = (await crowdEntries(ctx, id, locked)).map((e) => e.payload);
    const shown = locked ? entries.length > 0 : entries.length >= MIN_CROWD;
    return {
      matchweekId: id,
      players: entries.length,
      shown,
      minPlayers: MIN_CROWD,
      source: locked ? ("revealed" as const) : ("sealed" as const),
      fixtures: shown ? crowdCounts(entries, n).map((c, index) => ({ index, home: c.home, draw: c.draw, away: c.away })) : [],
    };
  });
}

type LiveState = "scheduled" | "live" | "ht" | "ft" | "void";

export interface LiveView {
  matchweekId: number;
  started: boolean;
  provisional: boolean;
  rules: 1 | 2;
  fixtures: { index: number; state: LiveState; home: number | null; away: number | null }[];
  players: number;
  table: { rank: number; name: string; points: number; exactScores: number; me: boolean }[];
  me: { rank: number; points: number; exactScores: number; fixtures: FixtureBreakdown[] } | null;
}

/**
 * Live match centre: scores as games are played, provisional points and table. Final once the
 * matchweek is finalized; until then nothing here is on-chain.
 */
export async function liveView(ctx: CoreContext, id: number, viewer?: { userId: string } | null): Promise<LiveView | null> {
  const mw = await matchweekRow(ctx, id);
  if (!mw) return null;
  const version = rulesVersion(mw.scoringRulesHash);
  const fixtures = await fixtureRows(ctx, id);
  if (ctx.now() < mw.lockTime) {
    return { matchweekId: id, started: false, provisional: true, rules: version, fixtures: [], players: 0, table: [], me: null };
  }

  const { view, results, entries, scored } = await provisional(ctx, id, version, fixtures);

  // The table shows one entry per person (their first-sealed wallet), like the season table.
  const first = new Map<string, (typeof scored)[number]>();
  for (const s of scored) {
    const cur = first.get(s.userId);
    const t = (x: typeof s) => x.sealedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (!cur || t(s) < t(cur)) first.set(s.userId, s);
  }
  const ranked = rank([...first.values()].map((s) => ({ ...s, id: s.userId })));
  const users = ranked.length
    ? await ctx.db
        .select({ id: schema.users.id, displayName: schema.users.displayName, qieId: schema.users.qieId, deletedAt: schema.users.deletedAt })
        .from(schema.users)
        .where(inArray(schema.users.id, ranked.map((r) => r.entry.userId)))
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const visible = ranked.filter((r) => !byId.get(r.entry.userId)?.deletedAt);
  const mine = viewer ? visible.find((r) => r.entry.userId === viewer.userId) : undefined;

  return {
    matchweekId: id,
    started: true,
    provisional: mw.status !== "finalized",
    rules: version,
    fixtures: view,
    players: visible.length,
    table: visible.slice(0, 10).map((r) => ({
      rank: r.rank,
      name: displayName(byId.get(r.entry.userId) ?? { displayName: null, qieId: null }, r.entry.wallet),
      points: r.entry.points,
      exactScores: r.entry.exactScores,
      me: r.entry.userId === viewer?.userId,
    })),
    me: mine
      ? { rank: mine.rank, points: mine.entry.points, exactScores: mine.entry.exactScores, fixtures: breakdown(version, mine.entry, entries, results) }
      : null,
  };
}

/**
 * Provisional scoring for a locked matchweek: live (or final) scores per fixture, and every valid
 * reveal scored against the games played so far, with the matchweek's rules.
 */
export async function provisional(ctx: CoreContext, id: number, version: 1 | 2, fixtures: Awaited<ReturnType<typeof fixtureRows>>) {
  // Live scores from the primary provider, cached a minute; stored results win once they exist.
  const done = fixtures.every((f) => f.status !== "scheduled");
  const football = ctx.football;
  const scores =
    done || !football
      ? []
      : await cached(ctx, `live:${id}`, 60_000, async () =>
          (await football.primary.matchday(id, ctx.season)).map((m) => ({ id: m.id, status: m.status, home: m.score.fullTime.home, away: m.score.fullTime.away })),
        ).catch(() => [] as { id: number; status: string; home: number | null; away: number | null }[]);

  const view = fixtures.map((f) => {
    if (f.status === "void") return { index: f.idx, state: "void" as LiveState, home: null, away: null };
    if (f.status === "played") return { index: f.idx, state: "ft" as LiveState, home: f.homeGoals, away: f.awayGoals };
    const s = scores.find((x) => x.id === f.externalId);
    const started = s && ["IN_PLAY", "PAUSED", "FINISHED"].includes(s.status) && s.home !== null && s.away !== null;
    if (!started) return { index: f.idx, state: "scheduled" as LiveState, home: null, away: null };
    const state: LiveState = s.status === "PAUSED" ? "ht" : s.status === "FINISHED" ? "ft" : "live";
    return { index: f.idx, state, home: s.home, away: s.away };
  });
  const results: FixtureResult[] = view
    .filter((f) => f.state !== "scheduled")
    .map((f) => ({ index: f.index, homeGoals: f.home ?? 0, awayGoals: f.away ?? 0, status: f.state === "void" ? "void" : "played" }));

  const entries = (await crowdEntries(ctx, id, true)).map((e) => ({ ...e, home: e.payload.home, away: e.payload.away, banker: e.payload.banker }));
  const scored = scoreEntries(version, entries, results);

  return { view, results, entries, scored };
}

/** One person's side for head-to-head: their first-sealed wallet's picks and points. */
export function sideFor<T extends { userId: string; sealedAt: Date | null }>(scored: T[], userId: string): T | undefined {
  return scored.filter((s) => s.userId === userId).sort((a, b) => (a.sealedAt?.getTime() ?? Infinity) - (b.sealedAt?.getTime() ?? Infinity))[0];
}

export { fixtureRows };

/** Like cached(), but on a provider error serve the last good value (or null) instead of failing. */
async function cachedOrStale<T>(ctx: CoreContext, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const [row] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  const hit = row?.value as { at: number; data: T } | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const data = await fn();
    const value = { at: Date.now(), data };
    await ctx.db
      .insert(schema.appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
    return data;
  } catch {
    return hit?.data ?? null;
  }
}

export interface MatchView {
  matchweekId: number;
  index: number;
  /** Games in the matchweek (a draft holds one pick per game). */
  fixtureCount: number;
  /** Odds model expected goals for this game (null before the first fit). */
  xg: { home: number; away: number } | null;
  home: string;
  away: string;
  kickoff: string;
  rules: 1 | 2;
  locked: boolean;
  finalized: boolean;
  state: LiveState;
  score: { home: number; away: number } | null;
  halfTime: { home: number; away: number } | null;
  minute: string | null;
  venue: string | null;
  referee: string | null;
  crowd: { players: number; shown: boolean; minPlayers: number; home: number; draw: number; away: number; scorelines: { home: number; away: number; count: number }[] };
  mine: { home: number | null; away: number | null; banker: boolean; sealed: boolean; points: FixtureBreakdown | null } | null;
  meetings: { date: string; home: string; away: string; homeGoals: number | null; awayGoals: number | null }[];
}

/** One game in detail: live state, the crowd market on it, your pick and points, earlier meetings. */
export async function matchView(ctx: CoreContext, id: number, index: number, viewer?: { userId: string } | null): Promise<MatchView | null> {
  const mw = await matchweekRow(ctx, id);
  if (!mw) return null;
  const fixtures = await fixtureRows(ctx, id);
  const f = fixtures.find((x) => x.idx === index);
  if (!f) return null;
  const version = rulesVersion(mw.scoringRulesHash);
  const locked = ctx.now() >= mw.lockTime;
  const odds = await oddsFor(ctx, id).catch(() => null);

  // Crowd market for this game (same rules as crowdView: hidden before lock until MIN_CROWD seals).
  const crowd = await cached(ctx, `crowdmatch:${id}:${index}:${locked ? "r" : "s"}`, locked ? 60_000 : 120_000, async () => {
    const entries = (await crowdEntries(ctx, id, locked)).map((e) => e.payload);
    const shown = locked ? entries.length > 0 : entries.length >= MIN_CROWD;
    const c = crowdCounts(entries, fixtures.length)[index] ?? { players: 0, home: 0, draw: 0, away: 0 };
    const tally = new Map<string, number>();
    for (const e of entries) {
      const k = `${e.home[index]}-${e.away[index]}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const scorelines = [...tally.entries()]
      .map(([k, count]) => ({ home: Number(k.split("-")[0]), away: Number(k.split("-")[1]), count }))
      .sort((a, b) => b.count - a.count || a.home + a.away - (b.home + b.away));
    return {
      players: entries.length,
      shown,
      minPlayers: MIN_CROWD,
      home: shown ? c.home : 0,
      draw: shown ? c.draw : 0,
      away: shown ? c.away : 0,
      scorelines: shown ? scorelines : [],
    };
  });

  // Live state and provisional points (after lock).
  const live = locked ? await provisional(ctx, id, version, fixtures) : null;
  const lf = live?.view.find((x) => x.index === index);
  const state: LiveState = lf?.state ?? (f.status === "void" ? "void" : f.status === "played" ? "ft" : "scheduled");
  const score = lf && lf.home !== null && lf.away !== null ? { home: lf.home, away: lf.away } : f.status === "played" ? { home: f.homeGoals ?? 0, away: f.awayGoals ?? 0 } : null;

  // Provider detail: refreshed every 2 minutes while it matters, otherwise hourly; head-to-head daily.
  const football = ctx.football;
  const liveNow = state === "live" || state === "ht" || (locked && state === "scheduled");
  const detail = football ? await cachedOrStale(ctx, `match:${f.externalId}`, liveNow ? 120_000 : 3_600_000, () => football.primary.match(f.externalId)) : null;
  const meetings = football ? ((await cachedOrStale(ctx, `h2h:${f.externalId}`, 86_400_000, () => football.primary.headToHead(f.externalId, 5))) ?? []) : [];

  // The viewer's own pick: before lock their draft or sealed payload, after lock their revealed pick.
  let mine: MatchView["mine"] = null;
  if (viewer) {
    const side = live ? sideFor(live.scored, viewer.userId) : undefined;
    if (side && live) {
      const b = breakdown(version, side, live.entries, live.results).find((x) => x.index === index) ?? null;
      mine = { home: side.home[index] ?? null, away: side.away[index] ?? null, banker: side.banker === index, sealed: true, points: b };
    } else {
      const rows = await ctx.db.select().from(schema.predictions).where(eq(schema.predictions.matchweekId, id));
      const row = rows.filter((r) => r.userId === viewer.userId).sort((a, b) => (a.sealedAt?.getTime() ?? Infinity) - (b.sealedAt?.getTime() ?? Infinity))[0];
      if (row) {
        let picks: { home: (number | null)[]; away: (number | null)[]; banker?: number | null } | null = null;
        if (row.payloadEnc) {
          try {
            picks = sealedPayloadSchema.parse(JSON.parse(ctx.crypto.decrypt(row.payloadEnc, payloadAad(row.wallet, id))));
          } catch {
            picks = null;
          }
        }
        if (!picks && row.draft) picks = row.draft as { home: (number | null)[]; away: (number | null)[]; banker?: number | null };
        if (picks) {
          mine = {
            home: picks.home[index] ?? null,
            away: picks.away[index] ?? null,
            banker: picks.banker === index,
            sealed: row.txStatus === "confirmed",
            points: null,
          };
        }
      }
    }
  }

  return {
    matchweekId: id,
    index,
    fixtureCount: fixtures.length,
    xg: (() => {
      const o = odds?.fixtures.find((x) => x.index === index);
      return o ? { home: o.home, away: o.away } : null;
    })(),
    home: f.home,
    away: f.away,
    kickoff: f.kickoff.toISOString(),
    rules: version,
    locked,
    finalized: mw.status === "finalized",
    state,
    score,
    halfTime: detail?.score.halfTime && detail.score.halfTime.home !== null && detail.score.halfTime.away !== null ? { home: detail.score.halfTime.home, away: detail.score.halfTime.away } : null,
    minute: detail?.minute != null && (state === "live" || state === "ht") ? String(detail.minute) : null,
    venue: detail?.venue ?? null,
    referee: detail?.referees?.find((r) => !r.type || r.type === "REFEREE")?.name ?? null,
    crowd,
    mine,
    meetings: meetings
      .filter((m) => m.id !== f.externalId && m.status === "FINISHED")
      .map((m) => ({
        date: m.utcDate,
        home: m.homeTeam.shortName ?? m.homeTeam.name ?? "?",
        away: m.awayTeam.shortName ?? m.awayTeam.name ?? "?",
        homeGoals: m.score.fullTime.home,
        awayGoals: m.score.fullTime.away,
      })),
  };
}
