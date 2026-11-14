import { sealedPayloadSchema, type SealedPayload } from "@northeside/commitments";
import { schema } from "@northeside/db";
import { breakdown, crowdCounts, rank, rulesVersion, scoreEntries, type FixtureBreakdown, type FixtureResult } from "@northeside/scoring";
import { asc, eq, inArray } from "drizzle-orm";
import type { CoreContext } from "./context";
import { payloadAad } from "./matchweek";
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
