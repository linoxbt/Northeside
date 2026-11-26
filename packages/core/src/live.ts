import { sealedPayloadSchema, type SealedPayload } from "@northeside/commitments";
import { schema } from "@northeside/db";
import { NO_PICK, breakdown, crowdCounts, pickAt, matchweekRulesVersion, scoreEntries, slipOf, type FixtureBreakdown, type FixtureResult } from "@northeside/scoring";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CoreContext } from "./context";
import { payloadAad } from "./matchweek";
import { firstPerPerson, personEntry, rankPeople } from "./people";
import { chanceSeries, fitsFor, oddsFor, type ChancePoint } from "./odds";
import { displayName } from "./queries";

/** Crowd odds before lock appear only once this many people have sealed (audit S1). */
export const MIN_CROWD = 20;
/** Before lock the crowd is a snapshot, refreshed at most this often... */
export const CROWD_SNAPSHOT_EVERY_MS = 6 * 3600_000;
/** ...and only once this many new people have sealed since the last one, so the difference between
 * two snapshots never isolates one person's picks. */
export const CROWD_SNAPSHOT_MIN_NEW = 10;
/**
 * Partial slips (rules v3): before lock, a game's crowd is shown only once this many people have
 * picked that game, so a game few people called cannot narrow down whose pick it is.
 */
export const MIN_GAME_CROWD = 10;

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

/** One entry per person (their first-sealed wallet), as on the tables. */
const perPerson = firstPerPerson;

interface CrowdSnapshot {
  at: number;
  players: number;
  fixtures: { index: number; home: number; draw: number; away: number }[];
}

/**
 * The crowd before lock (audit S1). Sealed picks are private until kickoff, but commit times and
 * wallets are public on-chain, so a live aggregate would let anyone diff it around one commit and
 * read that player's picks. Instead: one entry per person, nothing until MIN_CROWD people have
 * sealed, then a stored snapshot that is replaced at most every CROWD_SNAPSHOT_EVERY_MS and only
 * once CROWD_SNAPSHOT_MIN_NEW more people have sealed. No exact scores and no time series.
 */
export async function preLockCrowd(ctx: CoreContext, id: number, fixtureCount: number): Promise<{ players: number; snapshot: CrowdSnapshot | null }> {
  const people = perPerson(await crowdEntries(ctx, id, false));
  const key = `crowdsnap:${id}`;
  const [row] = await ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  let snap = (row?.value as CrowdSnapshot | undefined) ?? null;
  const now = ctx.now().getTime();
  const due = snap ? now - snap.at >= CROWD_SNAPSHOT_EVERY_MS && people.length - snap.players >= CROWD_SNAPSHOT_MIN_NEW : people.length >= MIN_CROWD;
  if (due) {
    snap = {
      at: now,
      players: people.length,
      fixtures: crowdCounts(people.map((e) => e.payload), fixtureCount)
        .map((c, index) => ({ index, home: c.home, draw: c.draw, away: c.away, players: c.players }))
        .filter((c) => c.players >= MIN_GAME_CROWD)
        .map(({ index, home, draw, away }) => ({ index, home, draw, away })),
    };
    await ctx.db
      .insert(schema.appSettings)
      .values({ key, value: snap })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: snap, updatedAt: new Date() } });
  }
  return { players: people.length, snapshot: snap };
}

/** Crowd odds: how many players call a home win, a draw or an away win in each game. */
export async function crowdView(ctx: CoreContext, id: number): Promise<CrowdView | null> {
  const mw = await matchweekRow(ctx, id);
  if (!mw) return null;
  const n = (await fixtureRows(ctx, id)).length;
  const locked = ctx.now() >= mw.lockTime;
  if (!locked) {
    const { players, snapshot } = await preLockCrowd(ctx, id, n);
    return { matchweekId: id, players, shown: !!snapshot, minPlayers: MIN_CROWD, source: "sealed", fixtures: snapshot?.fixtures ?? [] };
  }
  return cached(ctx, `crowd:${id}:revealed`, 60_000, async () => {
    const entries = (await crowdEntries(ctx, id, true)).map((e) => e.payload);
    const shown = entries.length > 0;
    return {
      matchweekId: id,
      players: entries.length,
      shown,
      minPlayers: MIN_CROWD,
      source: "revealed" as const,
      fixtures: shown ? crowdCounts(entries, n).map((c, index) => ({ index, home: c.home, draw: c.draw, away: c.away })) : [],
    };
  });
}

type LiveState = "scheduled" | "live" | "ht" | "ft" | "void";

export interface LiveView {
  matchweekId: number;
  started: boolean;
  provisional: boolean;
  rules: 1 | 2 | 3;
  fixtures: { index: number; state: LiveState; home: number | null; away: number | null; review?: ResultReview }[];
  players: number;
  table: { rank: number; name: string; points: number; exactScores: number; me: boolean }[];
  me: { rank: number; points: number; exactScores: number; fixtures: FixtureBreakdown[] } | null;
}

/** A result that is not settled yet because the two data providers do not (yet) agree. */
export interface ResultReview {
  kind: "conflict" | "waiting";
  message: string;
}

type CheckRow = {
  index: number;
  state: "agree" | "conflict" | "pending" | "missing";
  detail?: string;
  primary?: { status?: string; homeGoals?: number | null; awayGoals?: number | null };
  secondary?: { status?: string; homeGoals?: number | null; awayGoals?: number | null };
};

/**
 * Review flags from the stored two-provider cross-check: a conflict (the providers report different
 * results) or a game still unconfirmed 12 hours after kickoff. Nothing once results are proposed.
 * The providers stay the source of truth; this only tells players why a result is not settled.
 */
export function resultReviews(
  mw: { status: string; resultsCheck: unknown },
  fixtures: { idx: number; kickoff: Date }[],
  now: Date,
): Map<number, ResultReview> {
  const out = new Map<number, ResultReview>();
  if (!["open", "locked", "challenged"].includes(mw.status)) return out;
  const check = mw.resultsCheck as { rows?: CheckRow[]; sources?: { primary: string; secondary: string } } | null;
  const names = { primary: check?.sources?.primary?.replace(/ v\d+$/, "") ?? "the first provider", secondary: check?.sources?.secondary ?? "the second provider" };
  const side = (x?: CheckRow["primary"]) =>
    !x ? "nothing" : x.status === "played" ? `${x.homeGoals ?? 0}–${x.awayGoals ?? 0}` : x.status === "void" ? "postponed" : "not final";
  for (const r of check?.rows ?? []) {
    if (r.state === "conflict") {
      out.set(r.index, {
        kind: "conflict",
        message: `The two data providers disagree: ${names.primary} says ${side(r.primary)}, ${names.secondary} says ${side(r.secondary)}. Points stay provisional until it is resolved.`,
      });
    } else if (r.state === "pending" || r.state === "missing") {
      const f = fixtures.find((x) => x.idx === r.index);
      if (f && now.getTime() > f.kickoff.getTime() + 12 * 3600_000) {
        out.set(r.index, { kind: "waiting", message: "Waiting for both data providers to confirm the result. Points stay provisional until they do." });
      }
    }
  }
  return out;
}

/**
 * Live match centre: scores as games are played, provisional points and table. Final once the
 * matchweek is finalized; until then nothing here is on-chain.
 */
export async function liveView(ctx: CoreContext, id: number, viewer?: { userId: string } | null): Promise<LiveView | null> {
  const mw = await matchweekRow(ctx, id);
  if (!mw) return null;
  const version = matchweekRulesVersion(ctx.deployment.chainId, mw);
  const fixtures = await fixtureRows(ctx, id);
  if (ctx.now() < mw.lockTime) {
    return { matchweekId: id, started: false, provisional: true, rules: version, fixtures: [], players: 0, table: [], me: null };
  }

  const { view, results, entries, scored } = await provisional(ctx, id, version, fixtures);
  const reviews = resultReviews(mw, fixtures, ctx.now());

  // The table shows one entry per person (their first-sealed wallet), like the season table.
  const { ranked } = rankPeople(scored);
  const users = ranked.length
    ? await ctx.db
        .select({ id: schema.users.id, displayName: schema.users.displayName, qieId: schema.users.qieId, qieIdResolved: schema.users.qieIdResolved, deletedAt: schema.users.deletedAt })
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
    fixtures: view.map((f) => (reviews.has(f.index) ? { ...f, review: reviews.get(f.index)! } : f)),
    players: visible.length,
    table: visible.slice(0, 10).map((r) => ({
      rank: r.rank,
      name: displayName(byId.get(r.entry.userId) ?? { displayName: null, qieId: null, qieIdResolved: false }, r.entry.wallet),
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
export async function provisional(ctx: CoreContext, id: number, version: 1 | 2 | 3, fixtures: Awaited<ReturnType<typeof fixtureRows>>) {
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
export function sideFor<T extends { userId: string; wallet: string; sealedAt: Date | null }>(scored: T[], userId: string): T | undefined {
  return personEntry(scored, userId);
}

/**
 * Scores for a finalized matchweek never change, so they are computed once and reused for a few
 * minutes: player cards and the badge job read every finalized week for every player (audit P1).
 */
const FINAL_TTL_MS = 10 * 60_000;
const finalScores = new WeakMap<CoreContext, Map<number, { at: number; value: ReturnType<typeof provisional> }>>();
export function scoredWeek(ctx: CoreContext, mw: { id: number; status: string; scoringRulesHash: string | null }, fixtures: Awaited<ReturnType<typeof fixtureRows>>) {
  const version = matchweekRulesVersion(ctx.deployment.chainId, mw);
  if (mw.status !== "finalized") return provisional(ctx, mw.id, version, fixtures);
  let byId = finalScores.get(ctx);
  if (!byId) finalScores.set(ctx, (byId = new Map()));
  const hit = byId.get(mw.id);
  const now = Date.now();
  if (hit && now - hit.at < FINAL_TTL_MS) return hit.value;
  const value = provisional(ctx, mw.id, version, fixtures);
  byId.set(mw.id, { at: now, value });
  value.catch(() => byId!.delete(mw.id));
  return value;
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
  rules: 1 | 2 | 3;
  locked: boolean;
  finalized: boolean;
  state: LiveState;
  score: { home: number; away: number } | null;
  halfTime: { home: number; away: number } | null;
  minute: string | null;
  venue: string | null;
  referee: string | null;
  crowd: { players: number; shown: boolean; minPlayers: number; home: number; draw: number; away: number; scorelines: { home: number; away: number; count: number }[] };
  /** Chance of each result over time (model blended with the crowd), up to lock. */
  chart: ChancePoint[];
  /** Set while the two data providers disagree about this game (or have not confirmed it). */
  review: ResultReview | null;
  mine: { home: number | null; away: number | null; banker: boolean; sealed: boolean; points: FixtureBreakdown | null } | null;
  meetings: { date: string; home: string; away: string; homeGoals: number | null; awayGoals: number | null }[];
}

/**
 * A player's own slip before reveal: their sealed payload (decrypted) or, if they have not sealed,
 * their draft. The first-sealed wallet counts, as on the table. Never another player's slip.
 */
export async function ownSlip(
  ctx: CoreContext,
  id: number,
  userId: string,
): Promise<{ home: (number | null)[]; away: (number | null)[]; banker: number | null; sealed: boolean } | null> {
  const rows = await ctx.db
    .select()
    .from(schema.predictions)
    .where(and(eq(schema.predictions.matchweekId, id), eq(schema.predictions.userId, userId)));
  const row = rows.sort((a, b) => (a.sealedAt?.getTime() ?? Infinity) - (b.sealedAt?.getTime() ?? Infinity))[0];
  if (!row) return null;
  let picks: { home: (number | null)[]; away: (number | null)[]; banker?: number | null } | null = null;
  if (row.payloadEnc) {
    try {
      picks = sealedPayloadSchema.parse(JSON.parse(ctx.crypto.decrypt(row.payloadEnc, payloadAad(row.wallet, id))));
    } catch {
      picks = null;
    }
  }
  if (!picks && row.draft) picks = row.draft as { home: (number | null)[]; away: (number | null)[]; banker?: number | null };
  if (!picks) return null;
  // Sealed v3 slips mark skipped games as 255: show them as not picked.
  const shown = slipOf({ home: picks.home.map((x) => x ?? NO_PICK), away: picks.away.map((x) => x ?? NO_PICK), banker: picks.banker ?? null });
  return { ...shown, sealed: row.txStatus === "confirmed" };
}

/** One game in detail: live state, the crowd market on it, your pick and points, earlier meetings. */
export async function matchView(ctx: CoreContext, id: number, index: number, viewer?: { userId: string } | null): Promise<MatchView | null> {
  const mw = await matchweekRow(ctx, id);
  if (!mw) return null;
  const fixtures = await fixtureRows(ctx, id);
  const f = fixtures.find((x) => x.idx === index);
  if (!f) return null;
  const version = matchweekRulesVersion(ctx.deployment.chainId, mw);
  const locked = ctx.now() >= mw.lockTime;
  const odds = await oddsFor(ctx, id).catch(() => null);

  // Crowd market for this game. Before lock: the 1X2 snapshot only (no exact scores, no live
  // counts; audit S1). After lock: the revealed set, the one results are scored over.
  const crowd = locked
    ? await cached(ctx, `crowdmatch:${id}:${index}:r`, 60_000, async () => {
        const entries = (await crowdEntries(ctx, id, true)).map((e) => e.payload);
        const c = crowdCounts(entries, fixtures.length)[index] ?? { players: 0, home: 0, draw: 0, away: 0 };
        const tally = new Map<string, number>();
        for (const e of entries) {
          const p = pickAt(e, index);
          if (!p) continue; // skipped this game (rules v3)
          const k = `${p.home}-${p.away}`;
          tally.set(k, (tally.get(k) ?? 0) + 1);
        }
        const scorelines = [...tally.entries()]
          .map(([k, count]) => ({ home: Number(k.split("-")[0]), away: Number(k.split("-")[1]), count }))
          .sort((a, b) => b.count - a.count || a.home + a.away - (b.home + b.away));
        const shown = c.players > 0;
        return { players: c.players, shown, minPlayers: MIN_CROWD, home: c.home, draw: c.draw, away: c.away, scorelines: shown ? scorelines : [] };
      })
    : await (async () => {
        const { players, snapshot } = await preLockCrowd(ctx, id, fixtures.length);
        const c = snapshot?.fixtures.find((x) => x.index === index);
        return { players, shown: !!c, minPlayers: MIN_CROWD, home: c?.home ?? 0, draw: c?.draw ?? 0, away: c?.away ?? 0, scorelines: [] as { home: number; away: number; count: number }[] };
      })();

  // Chance over time: every model fit; the crowd joins the series only after lock (frozen at lock),
  // since a series of sealed picks would show when each pick was made (audit S1).
  const chart = await cached(ctx, `chart:${id}:${index}:${locked ? "r" : "s"}`, locked ? 3_600_000 : 300_000, async () => {
    const seals = locked
      ? (await crowdEntries(ctx, id, true)).flatMap((e) => {
          const p = pickAt(e.payload, index);
          if (!p || !e.sealedAt) return [];
          return [{ t: e.sealedAt, outcome: p.home > p.away ? ("home" as const) : p.home === p.away ? ("draw" as const) : ("away" as const) }];
        })
      : [];
    const now = ctx.now();
    return chanceSeries(await fitsFor(ctx, id, index), seals, { end: now < mw.lockTime ? now : mw.lockTime, minCrowd: 5 });
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
      const p = pickAt(side, index);
      mine = { home: p?.home ?? null, away: p?.away ?? null, banker: side.banker === index, sealed: true, points: b };
    } else {
      const slip = await ownSlip(ctx, id, viewer.userId);
      if (slip) mine = { home: slip.home[index] ?? null, away: slip.away[index] ?? null, banker: slip.banker === index, sealed: slip.sealed, points: null };
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
    chart,
    review: resultReviews(mw, fixtures, ctx.now()).get(index) ?? null,
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
