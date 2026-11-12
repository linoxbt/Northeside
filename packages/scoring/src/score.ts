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
