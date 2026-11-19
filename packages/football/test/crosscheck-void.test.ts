import { describe, expect, it } from "vitest";
import { crossCheck, type Fixture, type MatchResult } from "../src";

const t0 = Date.UTC(2026, 10, 21, 12) / 1000;
const fixtures: Fixture[] = [
  { externalId: 1, index: 0, home: "Arsenal", away: "Chelsea", kickoff: t0 },
  { externalId: 2, index: 1, home: "Everton", away: "Liverpool", kickoff: t0 + 3600 },
];

describe("crossCheck voids before needing the second source (audit B9)", () => {
  it("voids a game postponed past the window even when the second provider no longer lists it", () => {
    const primary: MatchResult[] = [
      { externalId: 1, home: "Arsenal", away: "Chelsea", kickoff: t0, status: "played", homeGoals: 2, awayGoals: 1 },
      { externalId: 2, home: "Everton", away: "Liverpool", kickoff: t0 + 30 * 86400, status: "pending", homeGoals: null, awayGoals: null },
    ];
    const secondary: MatchResult[] = [{ externalId: 901, home: "Arsenal", away: "Chelsea", kickoff: t0, status: "played", homeGoals: 2, awayGoals: 1 }];
    const c = crossCheck(fixtures, primary, secondary, { lockTime: t0, windowEnd: t0 + 3 * 86400 });
    expect(c.agreed).toBe(true);
    expect(c.results.find((r) => r.index === 1)).toMatchObject({ status: "void", reason: "rescheduled outside the matchweek" });
  });

  it("still waits for the second source on a normal game", () => {
    const primary: MatchResult[] = [
      { externalId: 1, home: "Arsenal", away: "Chelsea", kickoff: t0, status: "played", homeGoals: 2, awayGoals: 1 },
      { externalId: 2, home: "Everton", away: "Liverpool", kickoff: t0 + 3600, status: "played", homeGoals: 0, awayGoals: 0 },
    ];
    const c = crossCheck(fixtures, primary, [], { lockTime: t0, windowEnd: t0 + 3 * 86400 });
    expect(c.agreed).toBe(false);
    expect(c.rows.every((r) => r.state === "missing")).toBe(true);
  });
});
