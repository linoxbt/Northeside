import { pickedCount, sealedPayloadSchema } from "@northeside/commitments";
import { schema } from "@northeside/db";
import { breakdown, crowdCounts, explainPick, pickAt, matchweekRulesVersion } from "@northeside/scoring";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { CoreContext } from "./context";
import { fixtureRows, scoredWeek, sideFor } from "./live";
import { rankPeople } from "./people";
import { payloadAad } from "./matchweek";
import { oddsFor, resultChances } from "./odds";
import { displayName } from "./queries";

/**
 * FR-38 fun layer: levels, sealing streaks, badges and invites. All cosmetic: nothing here is a
 * prize, changes points or is paid out. Points and badges count finalized matchweeks only, so they
 * never flicker while games are live.
 */

export const LEVELS = [
  { name: "Rookie", min: 0 },
  { name: "Fan", min: 10 },
  { name: "Regular", min: 25 },
  { name: "Pundit", min: 50 },
  { name: "Analyst", min: 80 },
  { name: "Scout", min: 120 },
  { name: "Oracle", min: 175 },
  { name: "Legend", min: 250 },
] as const;

export const BADGES = [
  { id: "first-seal", name: "First seal", how: "Seal a slip on QIE" },
  { id: "full-slip", name: "Full slip", how: "Seal a pick for every game" },
  { id: "early-bird", name: "Early bird", how: "Seal 48 hours before lock" },
  { id: "on-fire", name: "On fire", how: "Seal 3 matchweeks in a row", target: 3 },
  { id: "sniper", name: "Sniper", how: "Call an exact score" },
  { id: "hat-trick", name: "Hat-trick", how: "3 exact scores in one matchweek" },
  { id: "banker", name: "Banker hit", how: "Your Banker comes in" },
  { id: "crowd-beater", name: "Crowd beater", how: "Earn the +3 beat-the-crowd bonus" },
  { id: "upset", name: "Upset caller", how: "Call a result the odds gave under 25%" },
  { id: "podium", name: "Podium", how: "Finish top 3 in a matchweek of 5+ players" },
  { id: "rival", name: "Rival", how: "Win a head-to-head" },
  { id: "recruiter", name: "Recruiter", how: "3 friends you invited seal a slip", target: 3 },
] as const;
export type BadgeId = (typeof BADGES)[number]["id"];

/** What one player did in one matchweek. Result facts are null until the matchweek is final. */
export interface WeekFacts {
  id: number;
  lockTime: Date;
  sealed: boolean;
  sealedAt: Date | null;
  picked: number;
  fixtures: number;
  final: {
    points: number;
    exact: number;
    rank: number;
    players: number;
    bankerHit: boolean;
    bestBonus: number;
    upsets: number;
    h2hWins: number;
  } | null;
}

export interface PlayerCard {
  points: number;
  level: { name: string; index: number; min: number; next: { name: string; min: number } | null };
  streak: { current: number; best: number; atRisk: boolean };
  badges: { id: BadgeId; name: string; how: string; earned: boolean; matchweek: number | null; progress: { n: number; target: number } | null }[];
  recruits: number;
}

/**
 * The card from a player's weeks. `top` is where the current streak is counted back from: the open
 * matchweek if sealed, else the latest locked one. `openUnsealed` marks a streak that the open
 * matchweek can still extend.
 */
export function buildCard(weeks: WeekFacts[], opts: { top: number | null; openUnsealed: boolean; recruits: number }): PlayerCard {
  const sorted = [...weeks].sort((a, b) => a.id - b.id);
  const points = sorted.reduce((s, w) => s + (w.final?.points ?? 0), 0);
  let li = 0;
  LEVELS.forEach((l, i) => {
    if (points >= l.min) li = i;
  });
  const lvl = LEVELS[li]!;
  const nxt = LEVELS[li + 1];

  const sealed = new Set(sorted.filter((w) => w.sealed).map((w) => w.id));
  let current = 0;
  for (let k = opts.top; k !== null && sealed.has(k); k--) current++;
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  let streak3At: number | null = null;
  for (const id of [...sealed].sort((a, b) => a - b)) {
    run = prev !== null && id === prev + 1 ? run + 1 : 1;
    prev = id;
    if (run >= 3 && streak3At === null) streak3At = id;
    best = Math.max(best, run);
  }

  const first = (p: (w: WeekFacts) => boolean) => sorted.find(p)?.id ?? null;
  const at: Record<BadgeId, number | null> = {
    "first-seal": first((w) => w.sealed),
    "full-slip": first((w) => w.sealed && w.fixtures > 0 && w.picked >= w.fixtures),
    "early-bird": first((w) => w.sealed && !!w.sealedAt && w.lockTime.getTime() - w.sealedAt.getTime() >= 48 * 3_600_000),
    "on-fire": streak3At,
    sniper: first((w) => (w.final?.exact ?? 0) >= 1),
    "hat-trick": first((w) => (w.final?.exact ?? 0) >= 3),
    banker: first((w) => !!w.final?.bankerHit),
    "crowd-beater": first((w) => (w.final?.bestBonus ?? 0) >= 3),
    upset: first((w) => (w.final?.upsets ?? 0) >= 1),
    podium: first((w) => !!w.final && w.final.players >= 5 && w.final.rank <= 3),
    rival: first((w) => (w.final?.h2hWins ?? 0) >= 1),
    recruiter: null,
  };
  const progress: Partial<Record<BadgeId, number>> = { "on-fire": best, recruiter: opts.recruits };

  return {
    points,
    level: { name: lvl.name, index: li, min: lvl.min, next: nxt ? { name: nxt.name, min: nxt.min } : null },
    streak: { current, best, atRisk: opts.openUnsealed && current > 0 },
    badges: BADGES.map((b) => {
      const target = "target" in b ? b.target : null;
      const n = progress[b.id] ?? 0;
      const earned = b.id === "recruiter" ? n >= target! : at[b.id] !== null;
      return {
        id: b.id,
        name: b.name,
        how: b.how,
        earned,
        matchweek: at[b.id],
        progress: target ? { n: Math.min(n, target), target } : null,
      };
    }),
    recruits: opts.recruits,
  };
}

/** Load a player's weeks from the index and build their card. */
export async function playerCard(ctx: CoreContext, userId: string): Promise<PlayerCard> {
  const now = ctx.now();
  const mws = await ctx.db.select().from(schema.matchweeks).orderBy(asc(schema.matchweeks.id));
  const rows = await ctx.db.select().from(schema.predictions).where(eq(schema.predictions.userId, userId));
  const challenges = await ctx.db
    .select()
    .from(schema.h2hChallenges)
    .where(and(isNotNull(schema.h2hChallenges.opponentUserId), or(eq(schema.h2hChallenges.challengerUserId, userId), eq(schema.h2hChallenges.opponentUserId, userId))));

  const weeks: WeekFacts[] = [];
  for (const mw of mws) {
    const mine = rows.filter((r) => r.matchweekId === mw.id);
    if (mine.length === 0) continue;
    // One slip per person per matchweek: the first-sealed wallet (as on the leaderboard).
    const row = [...mine].sort((a, b) => (a.sealedAt?.getTime() ?? Infinity) - (b.sealedAt?.getTime() ?? Infinity))[0]!;
    const sealed = row.txStatus === "confirmed";
    const fixtures = await fixtureRows(ctx, mw.id);
    let picked = 0;
    if (sealed && row.payloadEnc) {
      try {
        const p = sealedPayloadSchema.parse(JSON.parse(ctx.crypto.decrypt(row.payloadEnc, payloadAad(row.wallet, mw.id))));
        picked = pickedCount(p);
      } catch {
        picked = 0;
      }
    }
    let final: WeekFacts["final"] = null;
    if (sealed && mw.status === "finalized") {
      const version = matchweekRulesVersion(ctx.deployment.chainId, mw);
      const live = await scoredWeek(ctx, mw, fixtures);
      const me = sideFor(live.scored, userId);
      if (me) {
        const people = rankPeople(live.scored);
        const b = breakdown(version, me, live.entries, live.results);
        const odds = await oddsFor(ctx, mw.id).catch(() => null);
        const upsets = b.filter((x) => {
          if (x.points <= 0) return false;
          const r = live.results.find((y) => y.index === x.index);
          const xg = odds?.fixtures.find((y) => y.index === x.index);
          if (!r || r.status !== "played" || !xg) return false;
          const c = resultChances(xg);
          const outcome = r.homeGoals > r.awayGoals ? c.home : r.homeGoals === r.awayGoals ? c.draw : c.away;
          return outcome < 0.25;
        }).length;
        const h2hWins = challenges
          .filter((c) => c.matchweekId === mw.id)
          .filter((c) => {
            const other = sideFor(live.scored, c.challengerUserId === userId ? c.opponentUserId! : c.challengerUserId);
            return !other || me.points > other.points || (me.points === other.points && me.exactScores > other.exactScores);
          }).length;
        final = {
          points: me.points,
          exact: me.exactScores,
          rank: people.rankOf.get(userId) ?? people.players,
          players: people.players,
          bankerHit: b.some((x) => x.banker && x.points > 0),
          bestBonus: b.reduce((m, x) => Math.max(m, x.bonus), 0),
          upsets,
          h2hWins,
        };
      }
    }
    weeks.push({ id: mw.id, lockTime: mw.lockTime, sealed, sealedAt: row.sealedAt, picked, fixtures: fixtures.length, final });
  }

  const open = mws.filter((m) => m.lockTime > now && (m.status === "open" || m.status === "draft")).at(0) ?? null;
  const lastLocked = mws.filter((m) => m.lockTime <= now).at(-1) ?? null;
  const openSealed = !!open && weeks.some((w) => w.id === open.id && w.sealed);
  const top = openSealed ? open!.id : (lastLocked?.id ?? null);
  return buildCard(weeks, { top, openUnsealed: !!open && !openSealed, recruits: await recruitsOf(ctx, userId) });
}

const sealedSomething = sql`exists (select 1 from ${schema.predictions} p where p.user_id = ${schema.users.id} and p.tx_status = 'confirmed')`;

/** Friends this player invited who have sealed at least one slip. */
export async function recruitsOf(ctx: CoreContext, userId: string): Promise<number> {
  const [r] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(and(eq(schema.users.invitedBy, userId), isNull(schema.users.deletedAt), sealedSomething));
  return r?.n ?? 0;
}

/** Everyone a player invited, and how many of them sealed. */
export async function squadOf(ctx: CoreContext, userId: string) {
  const [r] = await ctx.db
    .select({ joined: sql<number>`count(*)::int`, sealed: sql<number>`count(*) filter (where ${sealedSomething})::int` })
    .from(schema.users)
    .where(and(eq(schema.users.invitedBy, userId), isNull(schema.users.deletedAt)));
  return { joined: r?.joined ?? 0, sealed: r?.sealed ?? 0 };
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A player's personal invite code, created on first use. */
export async function inviteCodeFor(ctx: CoreContext, userId: string): Promise<string> {
  const [u] = await ctx.db.select({ code: schema.users.inviteCode }).from(schema.users).where(eq(schema.users.id, userId));
  if (u?.code) return u.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = [...randomBytes(7)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    const done = await ctx.db
      .update(schema.users)
      .set({ inviteCode: code })
      .where(and(eq(schema.users.id, userId), isNull(schema.users.inviteCode)))
      .returning({ code: schema.users.inviteCode })
      .catch(() => []);
    if (done[0]?.code) return done[0].code;
    const [again] = await ctx.db.select({ code: schema.users.inviteCode }).from(schema.users).where(eq(schema.users.id, userId));
    if (again?.code) return again.code;
  }
  throw new Error("could not create an invite code");
}

/** Credit a brand-new account to the player whose invite brought them (never yourself). */
export async function creditInvite(ctx: CoreContext, newUserId: string, code: string): Promise<boolean> {
  const [inviter] = await ctx.db.select({ id: schema.users.id, deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.inviteCode, code.toLowerCase()));
  if (!inviter || inviter.deletedAt || inviter.id === newUserId) return false;
  const done = await ctx.db
    .update(schema.users)
    .set({ invitedBy: inviter.id, invitedAt: ctx.now() })
    .where(and(eq(schema.users.id, newUserId), isNull(schema.users.invitedBy)))
    .returning({ id: schema.users.id });
  return done.length > 0;
}

/** Top scouts: players ranked by invited friends who sealed a slip. Ties share a rank. */
export async function topScouts(ctx: CoreContext, limit = 20) {
  const recruits = ctx.db
    .select({ scout: schema.users.invitedBy, n: sql<number>`count(*)::int`.as("n") })
    .from(schema.users)
    .where(and(isNotNull(schema.users.invitedBy), isNull(schema.users.deletedAt), sealedSomething))
    .groupBy(schema.users.invitedBy)
    .as("recruits");
  const rows = await ctx.db
    .select({ id: schema.users.id, displayName: schema.users.displayName, qieId: schema.users.qieId, qieIdResolved: schema.users.qieIdResolved, deletedAt: schema.users.deletedAt, n: recruits.n })
    .from(recruits)
    .innerJoin(schema.users, eq(schema.users.id, recruits.scout))
    .orderBy(sql`${recruits.n} desc`, asc(schema.users.createdAt))
    .limit(limit);
  const live = rows.filter((r) => !r.deletedAt);
  const wallets = live.length
    ? await ctx.db.select().from(schema.wallets).where(inArray(schema.wallets.userId, live.map((r) => r.id)))
    : [];
  let prevN = -1;
  let prevRank = 0;
  return live.map((r, i) => {
    const rk = r.n === prevN ? prevRank : i + 1;
    prevN = r.n;
    prevRank = rk;
    const w = wallets.find((x) => x.userId === r.id)?.address ?? "0x0000000000000000000000000000000000000000";
    return { rank: rk, userId: r.id, name: displayName(r, w), recruits: r.n };
  });
}

// ---------------------------------------------------------------- weekly recap

/** "skip": a game the slip did not pick (rules v3). */
export type RecapCell = "exact" | "result" | "miss" | "skip" | "void";

export interface Recap {
  matchweekId: number;
  /** True once every game is over; final once the matchweek is finalized on-chain. */
  ready: boolean;
  final: boolean;
  name: string;
  points: number;
  rank: number;
  players: number;
  /** Share of the other players this one finished above (0-100). */
  beatPct: number;
  exact: number;
  results: number;
  games: number;
  grid: { cell: RecapCell; banker: boolean }[];
  banker: { home: string; away: string; points: number } | null;
  /** The right call the fewest players made. */
  bestCall: { home: string; away: string; pickHome: number; pickAway: number; exact: boolean; sharePct: number } | null;
  streak: number;
  level: string;
  /** Each game in one plain sentence (same numbers as the scoring). */
  lines: { home: string; away: string; text: string }[];
}

/** One player's matchweek in a shareable shape. Null if they had no revealed slip. */
export async function recapFor(ctx: CoreContext, matchweekId: number, userId: string): Promise<Recap | null> {
  const [mw] = await ctx.db.select().from(schema.matchweeks).where(eq(schema.matchweeks.id, matchweekId));
  if (!mw || ctx.now() < mw.lockTime) return null;
  const fixtures = await fixtureRows(ctx, mw.id);
  const version = matchweekRulesVersion(ctx.deployment.chainId, mw);
  const live = await scoredWeek(ctx, mw, fixtures);
  const me = sideFor(live.scored, userId);
  if (!me) return null;
  const ready = live.view.every((f) => f.state === "ft" || f.state === "void");

  // One entry per person (first-sealed wallet), ranked like the leaderboard.
  const { ranked } = rankPeople(live.scored);
  const mine = ranked.find((r) => r.entry.userId === userId)!;
  const below = ranked.filter((r) => r.rank > mine.rank).length;
  const players = ranked.length;

  const b = breakdown(version, me, live.entries, live.results);
  const crowd = crowdCounts(live.entries, fixtures.length);
  const grid = fixtures.map((f) => {
    const x = b.find((y) => y.index === f.idx);
    const r = live.results.find((y) => y.index === f.idx);
    const cell: RecapCell = !r || r.status === "void" ? "void" : x?.skipped ? "skip" : x?.exact ? "exact" : (x?.points ?? 0) > 0 ? "result" : "miss";
    return { cell, banker: me.banker === f.idx };
  });
  let bestCall: Recap["bestCall"] = null;
  for (const x of b) {
    const r = live.results.find((y) => y.index === x.index);
    if (!r || r.status === "void" || x.points <= 0) continue;
    const c = crowd[x.index]!;
    const total = c.players || 1;
    const o = r.homeGoals > r.awayGoals ? c.home : r.homeGoals === r.awayGoals ? c.draw : c.away;
    const sharePct = Math.round((o * 100) / total);
    const f = fixtures.find((y) => y.idx === x.index)!;
    if (sharePct >= 100) continue; // everyone called it: not a "best call"
    if (!bestCall || sharePct < bestCall.sharePct || (sharePct === bestCall.sharePct && x.exact && !bestCall.exact)) {
      const p = pickAt(me, x.index)!;
      bestCall = { home: f.home, away: f.away, pickHome: p.home, pickAway: p.away, exact: x.exact, sharePct };
    }
  }
  const lines = fixtures.map((f) => {
    const x = b.find((y) => y.index === f.idx) ?? null;
    const r = live.results.find((y) => y.index === f.idx);
    const v = live.view.find((y) => y.index === f.idx);
    const pick = pickAt(me, f.idx);
    const c = crowd[f.idx];
    const o = pick ? (pick.home > pick.away ? "home" : pick.home < pick.away ? "away" : "draw") : null;
    const text = explainPick({
      home: f.home,
      away: f.away,
      pick,
      result: r ? { status: r.status, home: r.homeGoals, away: r.awayGoals } : null,
      live: v?.state === "live" || v?.state === "ht",
      banker: me.banker === f.idx,
      points: x,
      crowd: o && c ? { called: c[o], players: c.players } : null,
    });
    return { home: f.home, away: f.away, text };
  });
  const bk = b.find((x) => x.banker);
  const bkF = bk ? fixtures.find((y) => y.idx === bk.index) : undefined;
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
  const card = await playerCard(ctx, userId);
  return {
    matchweekId: mw.id,
    ready,
    final: mw.status === "finalized",
    name: u && !u.deletedAt ? displayName(u, me.wallet) : "Player",
    points: me.points,
    rank: mine.rank,
    players,
    beatPct: players > 1 ? Math.round((below * 100) / (players - 1)) : 100,
    exact: grid.filter((g) => g.cell === "exact").length,
    results: grid.filter((g) => g.cell === "exact" || g.cell === "result").length,
    games: grid.filter((g) => g.cell !== "void").length,
    grid,
    banker: bk && bkF ? { home: bkF.home, away: bkF.away, points: bk.points } : null,
    bestCall,
    streak: card.streak.current,
    level: card.level.name,
    lines,
  };
}

/** The player behind an invite code (recap links use it so no wallet appears in the URL). */
export async function userByInviteCode(ctx: CoreContext, code: string) {
  if (!/^[a-z0-9]{4,16}$/.test(code)) return null;
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.inviteCode, code));
  return u && !u.deletedAt ? u : null;
}

/** Wordle-style share line: 🟩 exact, 🟨 right result, ⬛ miss, ▫️ void. */
export function recapEmoji(grid: Recap["grid"]) {
  return grid.map((g) => (g.cell === "exact" ? "🟩" : g.cell === "result" ? "🟨" : g.cell === "miss" ? "⬛" : g.cell === "skip" ? "⬜" : "▫️")).join("");
}
