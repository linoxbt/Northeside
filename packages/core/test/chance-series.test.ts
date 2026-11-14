import { describe, expect, it } from "vitest";
import { chanceSeries, resultChances } from "../src/odds";

const T = (h: number) => new Date(Date.UTC(2026, 10, 14, h));

describe("chance over time", () => {
  const fits = [
    { t: T(0).toISOString(), home: 1.8, away: 0.9 },
    { t: T(6).toISOString(), home: 1.2, away: 1.2 },
  ];

  it("follows the model fits and ends at the given time", () => {
    const s = chanceSeries(fits, [], { end: T(10), minCrowd: 5 });
    expect(s.map((p) => p.t)).toEqual([T(0), T(6), T(10)].map((d) => d.toISOString()));
    const first = resultChances(fits[0]!);
    expect(s[0]!.home).toBeCloseTo(first.home, 3);
    expect(s[0]!.home).toBeGreaterThan(s[1]!.home);
    expect(s[2]).toMatchObject({ home: s[1]!.home, draw: s[1]!.draw, away: s[1]!.away });
    for (const p of s) expect(p.home + p.draw + p.away).toBeCloseTo(1, 3);
  });

  it("blends the crowd in only once enough have sealed, rounded up to the hour", () => {
    const seals = Array.from({ length: 5 }, (_, i) => ({ t: new Date(T(7).getTime() + i * 60_000 + 1), outcome: "away" as const }));
    const s = chanceSeries(fits, seals.slice(0, 4), { end: T(10), minCrowd: 5 });
    const model = resultChances(fits[1]!);
    expect(s.at(-1)!.away).toBeCloseTo(model.away, 3); // 4 seals: hidden
    const t = chanceSeries(fits, seals, { end: T(10), minCrowd: 5 });
    expect(t.map((p) => p.t)).toContain(T(8).toISOString());
    expect(t.at(-1)!.away).toBeCloseTo((30 * model.away + 5) / 35, 3);
  });

  it("is empty before the first fit and thins long series", () => {
    expect(chanceSeries([], [], { end: T(10), minCrowd: 5 })).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ t: new Date(Date.UTC(2026, 10, 1) + i * 3_600_000).toISOString(), home: 1.5, away: 1 }));
    const s = chanceSeries(many, [], { end: new Date(Date.UTC(2026, 10, 10)), minCrowd: 5, maxPoints: 10 });
    expect(s).toHaveLength(10);
    expect(s[0]!.t).toBe(many[0]!.t);
  });
});
