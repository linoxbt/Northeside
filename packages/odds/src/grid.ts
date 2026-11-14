/**
 * Score-probability grid and markets. Pure maths with no imports, so the browser can use it.
 */

function poisson(k: number, lambda: number) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

export const MAX_GOALS = 9;

/** Probability of every scoreline 0..9 x 0..9 (Dixon–Coles corrected, normalised to 1). */
export function scoreGrid(lambdaHome: number, lambdaAway: number, rho = -0.08): number[][] {
  const g: number[][] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    g.push([]);
    for (let a = 0; a <= MAX_GOALS; a++) {
      let p = poisson(h, lambdaHome) * poisson(a, lambdaAway);
      if (h === 0 && a === 0) p *= 1 - lambdaHome * lambdaAway * rho;
      else if (h === 0 && a === 1) p *= 1 + lambdaHome * rho;
      else if (h === 1 && a === 0) p *= 1 + lambdaAway * rho;
      else if (h === 1 && a === 1) p *= 1 - rho;
      p = Math.max(p, 0);
      g[h]!.push(p);
      total += p;
    }
  }
  return g.map((row) => row.map((p) => p / total));
}

/**
 * Blend the model with the crowd's picks, like a market moving: each crowd pick counts as one
 * observation against `k` pseudo-observations from the model. Scores outside the grid are capped.
 */
export function blendGrid(grid: number[][], crowd: { home: number; away: number; count: number }[], k = 30): number[][] {
  const n = crowd.reduce((s, c) => s + c.count, 0);
  if (n === 0) return grid;
  const counts = grid.map((row) => row.map(() => 0));
  for (const c of crowd) counts[Math.min(c.home, MAX_GOALS)]![Math.min(c.away, MAX_GOALS)]! += c.count;
  return grid.map((row, h) => row.map((p, a) => (k * p + counts[h]![a]!) / (k + n)));
}

/** Probability that the score satisfies a predicate (a market selection). */
export function probabilityOf(grid: number[][], wins: (home: number, away: number) => boolean): number {
  let p = 0;
  grid.forEach((row, h) => row.forEach((q, a) => (p += wins(h, a) ? q : 0)));
  return p;
}

/** Fair decimal odds (no margin: nobody stakes anything), two decimals, 1.01 to 500. */
export function fairOdds(p: number): string {
  if (!(p > 0)) return "500+";
  const o = 1 / p;
  if (o >= 500) return "500+";
  return Math.max(1.01, Math.floor(o * 100) / 100).toFixed(2);
}
