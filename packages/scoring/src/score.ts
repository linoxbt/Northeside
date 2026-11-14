import { RULES_V1 } from "./rules";

export type FixtureStatus = "played" | "void";

export interface FixtureResult {
  index: number;
  homeGoals: number;
  awayGoals: number;
  /** A postponed or abandoned fixture is void: it scores zero for everyone. */
  status: FixtureStatus;
}

export interface FixtureScore {
  points: number;
  exact: boolean;
}

const outcome = (h: number, a: number) => Math.sign(h - a);

/** Exact score = 5, correct outcome (home win / draw / away win) = 2, wrong = 0, void = 0. */
export function scoreFixture(predHome: number, predAway: number, result: FixtureResult): FixtureScore {
  if (result.status === "void") return { points: RULES_V1.voidFixture, exact: false };
  if (predHome === result.homeGoals && predAway === result.awayGoals) {
    return { points: RULES_V1.exactScore, exact: true };
  }
  if (outcome(predHome, predAway) === outcome(result.homeGoals, result.awayGoals)) {
    return { points: RULES_V1.correctOutcome, exact: false };
  }
  return { points: RULES_V1.wrong, exact: false };
}

export interface PlayerScore {
  points: number;
  exactScores: number;
}

export function scorePicks(picks: { home: number[]; away: number[] }, results: FixtureResult[]): PlayerScore {
  let points = 0;
  let exactScores = 0;
  for (const r of results) {
    const h = picks.home[r.index];
    const a = picks.away[r.index];
    if (h === undefined || a === undefined) throw new Error(`No prediction for fixture ${r.index}`);
    const s = scoreFixture(h, a, r);
    points += s.points;
    if (s.exact) exactScores += 1;
  }
  return { points, exactScores };
}

export interface RankInput {
  id: string;
  points: number;
  exactScores: number;
}

export interface Ranked<T extends RankInput> {
  rank: number;
  entry: T;
}

/**
 * Standard competition ranking ("1, 1, 3"): points desc, then exact scores desc. Players equal on
 * both share a rank. Order within a shared rank is by id, purely for stable display.
 */
export function rank<T extends RankInput>(entries: T[]): Ranked<T>[] {
  const sorted = [...entries].sort(
    (x, y) => y.points - x.points || y.exactScores - x.exactScores || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  const out: Ranked<T>[] = [];
  sorted.forEach((entry, i) => {
    const prev = out[i - 1];
    const tied = prev && prev.entry.points === entry.points && prev.entry.exactScores === entry.exactScores;
    out.push({ rank: tied ? prev.rank : i + 1, entry });
  });
  return out;
}

// ------------------------------------------------------------------ rules v2

/** How many scored players called each result (home win / draw / away win) for one fixture. */
export interface CrowdCount {
  players: number;
  home: number;
  draw: number;
  away: number;
}

export interface Entry {
  home: number[];
  away: number[];
  /** v2: Banker fixture index, or 255 / undefined for none. */
  banker?: number;
}

const NO_BANKER = 255;

/** Crowd counts per fixture index, from every scored entry's picks. */
export function crowdCounts(entries: Entry[], fixtureCount: number): CrowdCount[] {
  const out: CrowdCount[] = Array.from({ length: fixtureCount }, () => ({ players: entries.length, home: 0, draw: 0, away: 0 }));
  for (const e of entries) {
    for (let i = 0; i < fixtureCount; i++) {
      const o = outcome(e.home[i]!, e.away[i]!);
      if (o > 0) out[i]!.home++;
      else if (o === 0) out[i]!.draw++;
      else out[i]!.away++;
    }
  }
  return out;
}

/** Beat-the-crowd bonus for a correct call that `called` of `players` scored players made. */
export function crowdBonus(called: number, players: number): number {
  if (players <= 0 || called <= 0) return 0;
  if (called * 10 <= players) return 3;
  if (called * 4 <= players) return 2;
  if (called * 2 <= players) return 1;
  return 0;
}

/** Points for one fixture under rules v2 (before the Banker doubling). */
export function scoreFixtureV2(predHome: number, predAway: number, result: FixtureResult, crowd: CrowdCount): FixtureScore & { bonus: number } {
  const base = scoreFixture(predHome, predAway, result);
  if (result.status === "void" || base.points === 0) return { ...base, bonus: 0 };
  const o = outcome(result.homeGoals, result.awayGoals);
  const called = o > 0 ? crowd.home : o === 0 ? crowd.draw : crowd.away;
  const bonus = crowdBonus(called, crowd.players);
  return { points: base.points + bonus, exact: base.exact, bonus };
}

/**
 * Score every entry of a matchweek. v1: points per fixture. v2: crowd bonus from all entries, and
 * the Banker fixture counts double. The crowd is exactly the list passed in.
 */
export function scoreEntries<T extends Entry>(version: 1 | 2, entries: T[], results: FixtureResult[]): (T & PlayerScore)[] {
  if (version === 1) return entries.map((e) => ({ ...e, ...scorePicks(e, results) }));
  const n = results.reduce((m, r) => Math.max(m, r.index + 1), 0);
  const crowd = crowdCounts(entries, n);
  return entries.map((e) => {
    let points = 0;
    let exactScores = 0;
    for (const r of results) {
      const h = e.home[r.index];
      const a = e.away[r.index];
      if (h === undefined || a === undefined) throw new Error(`No prediction for fixture ${r.index}`);
      const s = scoreFixtureV2(h, a, r, crowd[r.index]!);
      points += e.banker !== undefined && e.banker !== NO_BANKER && e.banker === r.index ? s.points * 2 : s.points;
      if (s.exact) exactScores += 1;
    }
    return { ...e, points, exactScores };
  });
}

export interface FixtureBreakdown {
  index: number;
  points: number;
  bonus: number;
  exact: boolean;
  banker: boolean;
}

/** One entry's points per fixture (Banker doubling applied), against the crowd of `all` entries. */
export function breakdown(version: 1 | 2, entry: Entry, all: Entry[], results: FixtureResult[]): FixtureBreakdown[] {
  const n = results.reduce((m, r) => Math.max(m, r.index + 1), 0);
  const crowd = version === 2 ? crowdCounts(all, n) : null;
  return results.map((r) => {
    const h = entry.home[r.index]!;
    const a = entry.away[r.index]!;
    const isBanker = version === 2 && entry.banker !== undefined && entry.banker !== NO_BANKER && entry.banker === r.index;
    const s = crowd ? scoreFixtureV2(h, a, r, crowd[r.index]!) : { ...scoreFixture(h, a, r), bonus: 0 };
    return { index: r.index, points: isBanker ? s.points * 2 : s.points, bonus: s.bonus, exact: s.exact, banker: isBanker };
  });
}
