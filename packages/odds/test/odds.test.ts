import { describe, expect, it } from "vitest";
import { blendGrid, expectedGoals, fairOdds, fitRatings, key, probabilityOf, scoreGrid, type MatchResult } from "../src";

/** Deterministic PRNG so the simulated seasons are the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function poissonDraw(lambda: number, r: () => number) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

/** A double round-robin with known strengths. */
function simulate(strength: Record<string, { att: number; def: number }>, seasons = 2, seed = 7): MatchResult[] {
  const r = rng(seed);
  const teams = Object.keys(strength);
  const out: MatchResult[] = [];
  let day = 0;
  for (let s = 0; s < seasons; s++)
    for (const h of teams)
      for (const a of teams) {
        if (h === a) continue;
        const lh = Math.exp(0.25 + 0.25 + strength[h]!.att - strength[a]!.def);
        const la = Math.exp(0.25 + strength[a]!.att - strength[h]!.def);
        out.push({ home: h, away: a, homeGoals: poissonDraw(lh, r), awayGoals: poissonDraw(la, r), date: new Date(Date.UTC(2025, 7, 1) + day++ * 86_400_000).toISOString() });
      }
  return out;
}

const STRENGTH = {
  "Strong FC": { att: 0.5, def: 0.4 },
  "Good FC": { att: 0.25, def: 0.2 },
  "Mid FC": { att: 0, def: 0 },
  "Weak FC": { att: -0.25, def: -0.2 },
  "Poor FC": { att: -0.5, def: -0.4 },
};

describe("Dixon-Coles odds engine", () => {
  const matches = simulate(STRENGTH, 8);
  const asOf = new Date(matches.at(-1)!.date);
  const r = fitRatings(matches, { asOf, halfLifeDays: 10_000 });

  it("recovers the order of team strengths and a positive home advantage", () => {
    // Overall strength (attack + defence) in the order it was simulated.
    const order = Object.keys(STRENGTH).map((t) => r.attack[key(t)]! + r.defence[key(t)]!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!).toBeGreaterThan(order[i]!);
    expect(r.home).toBeGreaterThan(0.05);
    expect(r.matches).toBe(160);
  });

  it("the stronger side gets more expected goals and is the favourite", () => {
    const xg = expectedGoals(r, "Strong FC", "Poor FC");
    expect(xg.home).toBeGreaterThan(xg.away * 2);
    const g = scoreGrid(xg.home, xg.away);
    const pHome = probabilityOf(g, (h, a) => h > a);
    const pAway = probabilityOf(g, (h, a) => h < a);
    expect(pHome).toBeGreaterThan(0.6);
    expect(pAway).toBeLessThan(0.15);
  });

  it("the grid is a probability distribution and the markets are consistent", () => {
    const g = scoreGrid(1.6, 1.1);
    const total = probabilityOf(g, () => true);
    expect(total).toBeCloseTo(1, 10);
    const p1 = probabilityOf(g, (h, a) => h > a), px = probabilityOf(g, (h, a) => h === a), p2 = probabilityOf(g, (h, a) => h < a);
    expect(p1 + px + p2).toBeCloseTo(1, 10);
    expect(probabilityOf(g, (h, a) => h + a > 2.5) + probabilityOf(g, (h, a) => h + a < 2.5)).toBeCloseTo(1, 10);
    // Dixon-Coles with rho < 0 makes 0-0 and 1-1 a little more likely than plain Poisson.
    const plain = scoreGrid(1.6, 1.1, 0);
    expect(g[1]![1]!).toBeGreaterThan(plain[1]![1]!);
  });

  it("promoted teams start below average through the prior", () => {
    const priorFor = (k: string) => (k === "newcomer" ? { attack: -0.3, defence: -0.3 } : { attack: 0, defence: 0 });
    const xg = expectedGoals(r, "Mid FC", "Newcomer", priorFor);
    const avg = expectedGoals(r, "Mid FC", "Unknown Average");
    expect(xg.home).toBeGreaterThan(avg.home);
    expect(xg.away).toBeLessThan(avg.away);
  });

  it("recent results weigh more with a short half-life", () => {
    const old: MatchResult[] = Array.from({ length: 10 }, (_, i) => ({ home: "A", away: "B", homeGoals: 3, awayGoals: 0, date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString() }));
    const recent: MatchResult[] = Array.from({ length: 10 }, (_, i) => ({ home: "A", away: "B", homeGoals: 0, awayGoals: 3, date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() }));
    const fitted = fitRatings([...old, ...recent], { asOf: new Date(Date.UTC(2026, 10, 1)), halfLifeDays: 60 });
    const xg = expectedGoals(fitted, "A", "B");
    expect(xg.away).toBeGreaterThan(xg.home);
  });

  it("blending moves the market towards the crowd, more as the crowd grows", () => {
    const g = scoreGrid(1.4, 1.2);
    const draw = (x: number[][]) => probabilityOf(x, (h, a) => h === a);
    const few = blendGrid(g, [{ home: 1, away: 1, count: 5 }], 30);
    const many = blendGrid(g, [{ home: 1, away: 1, count: 300 }], 30);
    expect(draw(few)).toBeGreaterThan(draw(g));
    expect(draw(many)).toBeGreaterThan(draw(few));
    expect(probabilityOf(many, () => true)).toBeCloseTo(1, 10);
    expect(blendGrid(g, [])).toBe(g);
  });

  it("fair odds are 1 / probability, rounded down, within 1.01 and 500", () => {
    expect(fairOdds(0.5)).toBe("2.00");
    expect(fairOdds(1 / 3)).toBe("3.00");
    expect(fairOdds(0.62)).toBe("1.61");
    expect(fairOdds(0.999)).toBe("1.01");
    expect(fairOdds(0.0001)).toBe("500+");
    expect(fairOdds(0)).toBe("500+");
  });
});
