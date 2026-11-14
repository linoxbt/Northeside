import { blendGrid, fairOdds, MAX_GOALS as GRID_MAX, probabilityOf, scoreGrid } from "@northeside/odds/grid";
/**
 * Betting-style markets derived from one exact-score pick. A player's pick is always a single
 * score; every market (1X2, double chance, over/under 2.5, both teams to score, correct score)
 * is a view of it, and tapping a market moves the pick to the nearest score that satisfies it.
 */

export type Score = { home: number; away: number };
export type Outcome = "home" | "draw" | "away";

export type Selection =
  | { market: "1x2"; value: Outcome }
  | { market: "dc"; value: "1X" | "12" | "X2" }
  | { market: "ou"; value: "over" | "under" }
  | { market: "gg"; value: "yes" | "no" }
  | { market: "cs"; value: Score };

export const MAX_GOALS = 9;

export const outcome = (s: Score): Outcome => (s.home > s.away ? "home" : s.home === s.away ? "draw" : "away");
const over = (s: Score) => s.home + s.away > 2.5;
const gg = (s: Score) => s.home > 0 && s.away > 0;

/** Does `s` win `sel`? */
export function satisfies(s: Score, sel: Selection): boolean {
  switch (sel.market) {
    case "1x2":
      return outcome(s) === sel.value;
    case "dc":
      return sel.value === "1X" ? outcome(s) !== "away" : sel.value === "12" ? outcome(s) !== "draw" : outcome(s) !== "home";
    case "ou":
      return sel.value === "over" ? over(s) : !over(s);
    case "gg":
      return sel.value === "yes" ? gg(s) : !gg(s);
    case "cs":
      return s.home === sel.value.home && s.away === sel.value.away;
  }
}

/** Typical starting scores when there is no pick yet. */
const DEFAULTS: Score[] = [
  { home: 1, away: 0 },
  { home: 1, away: 1 },
  { home: 0, away: 1 },
  { home: 2, away: 1 },
  { home: 1, away: 2 },
  { home: 2, away: 0 },
  { home: 0, away: 2 },
  { home: 0, away: 0 },
  { home: 2, away: 2 },
];

/**
 * The pick after tapping `sel`: the closest score that satisfies it, changing as little else
 * as possible (keeps the result, then over/under, then both-teams-to-score). Deterministic.
 */
export function applySelection(current: Score | null, sel: Selection): Score {
  if (sel.market === "cs") return sel.value;
  if (!current) return DEFAULTS.find((d) => satisfies(d, sel))!;
  if (satisfies(current, sel)) return current;
  let best: Score | null = null;
  let bestCost = Infinity;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const s = { home: h, away: a };
      if (!satisfies(s, sel)) continue;
      let cost = Math.abs(h - current.home) + Math.abs(a - current.away);
      if (sel.market !== "1x2" && sel.market !== "dc" && outcome(s) !== outcome(current)) cost += 10;
      if (sel.market !== "ou" && over(s) !== over(current)) cost += 3;
      if (sel.market !== "gg" && gg(s) !== gg(current)) cost += 3;
      // Tie-break: fewer goals, then the home side (listed first), so the result is stable.
      cost += (h + a) * 0.01 - h * 0.001;
      if (cost < bestCost) {
        bestCost = cost;
        best = s;
      }
    }
  }
  return best!;
}

/** Crowd odds: 1 ÷ the share of players on a selection, two decimals; null if nobody is on it. */
export function crowdOdds(count: number, total: number): string | null {
  if (total <= 0 || count <= 0) return null;
  return (Math.floor((total / count) * 100) / 100).toFixed(2);
}

/** How many crowd picks satisfy each selection, from the exact-score distribution. */
export function crowdCount(scores: { home: number; away: number; count: number }[], sel: Selection): number {
  return scores.filter((s) => satisfies(s, sel)).reduce((a, s) => a + s.count, 0);
}

/** Correct-score grid, SportyBet-style: home-win scores, draws, away-win scores. */
export const CORRECT_SCORES: Record<Outcome, Score[]> = {
  home: [
    [1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [4, 2], [4, 3],
  ].map(([home, away]) => ({ home: home!, away: away! })),
  draw: [
    [0, 0], [1, 1], [2, 2], [3, 3], [4, 4],
  ].map(([home, away]) => ({ home: home!, away: away! })),
  away: [
    [0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3], [0, 4], [1, 4], [2, 4], [3, 4],
  ].map(([home, away]) => ({ home: home!, away: away! })),
};

// ------------------------------------------------------------------ odds engine (client side)


/**
 * The score-probability grid for a game: the model's expected goals (Dixon–Coles), blended with
 * the crowd's picks once they are shown. Crowd only when there is no model yet; null if neither.
 */
export function marketGrid(xg: { home: number; away: number } | null | undefined, crowd: { home: number; away: number; count: number }[] | null): number[][] | null {
  if (xg) return crowd && crowd.length ? blendGrid(scoreGrid(xg.home, xg.away), crowd) : scoreGrid(xg.home, xg.away);
  if (!crowd || crowd.length === 0) return null;
  const n = crowd.reduce((s, c) => s + c.count, 0);
  const g = Array.from({ length: GRID_MAX + 1 }, () => Array<number>(GRID_MAX + 1).fill(0));
  for (const c of crowd) g[Math.min(c.home, GRID_MAX)]![Math.min(c.away, GRID_MAX)]! += c.count / n;
  return g;
}

/** Probability and fair decimal odds of a selection on a grid. */
export function selectionOdds(grid: number[][] | null, sel: Selection): { p: number; odds: string } | null {
  if (!grid) return null;
  const p = probabilityOf(grid, (home, away) => satisfies({ home, away }, sel));
  return p > 0 ? { p, odds: fairOdds(p) } : null;
}

/** 1X2 for the board: model probability blended with the crowd's result counts (k = 30 pseudo-picks). */
export function resultOdds(xg: { home: number; away: number } | null | undefined, crowd: { home: number; draw: number; away: number } | undefined, k = 30) {
  const g = xg ? scoreGrid(xg.home, xg.away) : null;
  const n = crowd ? crowd.home + crowd.draw + crowd.away : 0;
  const one = (o: Outcome) => {
    const model = g ? probabilityOf(g, (h, a) => outcome({ home: h, away: a }) === o) : null;
    const c = crowd ? crowd[o] : 0;
    const p = model !== null ? (n ? (k * model + c) / (k + n) : model) : n ? c / n : null;
    return p !== null && p > 0 ? { p, odds: fairOdds(p) } : null;
  };
  return { home: one("home"), draw: one("draw"), away: one("away") };
}
