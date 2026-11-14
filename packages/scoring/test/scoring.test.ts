import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { RULES_V1_HASH, RULES_V1_TEXT, computeHostPayouts, rank, scoreFixture, scorePicks, type FixtureResult, type PayoutCandidate, RULES_V2_HASH, CURRENT_RULES_HASH, rulesVersion, crowdBonus, scoreEntries } from "../src";

const played = (index: number, h: number, a: number): FixtureResult => ({ index, homeGoals: h, awayGoals: a, status: "played" });

describe("scoreFixture", () => {
  it("exact score = 5", () => expect(scoreFixture(2, 1, played(0, 2, 1))).toEqual({ points: 5, exact: true }));
  it("correct home win = 2", () => expect(scoreFixture(3, 0, played(0, 2, 1)).points).toBe(2));
  it("correct draw = 2", () => expect(scoreFixture(0, 0, played(0, 2, 2)).points).toBe(2));
  it("correct away win = 2", () => expect(scoreFixture(0, 1, played(0, 1, 4)).points).toBe(2));
  it("wrong = 0", () => expect(scoreFixture(2, 0, played(0, 0, 1)).points).toBe(0));
  it("void fixture scores zero even for an exact pick", () =>
    expect(scoreFixture(1, 1, { index: 0, homeGoals: 1, awayGoals: 1, status: "void" })).toEqual({
      points: 0,
      exact: false,
    }));
});

describe("scorePicks", () => {
  it("adds points and counts exact scores", () => {
    const picks = { home: [2, 1, 0, 3], away: [1, 1, 2, 0] };
    const results = [played(0, 2, 1), played(1, 0, 0), played(2, 1, 0), { ...played(3, 3, 0), status: "void" as const }];
    expect(scorePicks(picks, results)).toEqual({ points: 5 + 2 + 0 + 0, exactScores: 1 });
  });

  it("throws on a missing prediction", () => {
    expect(() => scorePicks({ home: [1], away: [1] }, [played(1, 0, 0)])).toThrow();
  });
});

describe("rank", () => {
  it("orders by points then exact scores, sharing ranks on full ties", () => {
    const r = rank([
      { id: "c", points: 20, exactScores: 2 },
      { id: "a", points: 25, exactScores: 1 },
      { id: "b", points: 20, exactScores: 3 },
      { id: "d", points: 20, exactScores: 2 },
      { id: "e", points: 10, exactScores: 0 },
    ]);
    expect(r.map((x) => [x.entry.id, x.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 3],
      ["e", 5],
    ]);
  });
});

describe("rules hash", () => {
  it("is stable", () => {
    expect(RULES_V1_TEXT).toContain('"exactScore":5');
    expect(RULES_V1_HASH).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

const host1 = "0x00000000000000000000000000000000000000a1" as Address;
const host2 = "0x00000000000000000000000000000000000000a2" as Address;
const p = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const cand = (person: number | null, host: Address, over: Partial<PayoutCandidate> = {}): PayoutCandidate => ({
  personHash: person === null ? null : p(person),
  leagueSlug: host === host1 ? "northfc" : "ada",
  host,
  sealedThisMatchweek: true,
  sealedEarlierMatchweek: true,
  ...over,
});

describe("computeHostPayouts", () => {
  const terms = { ratePerPlayer: 100_000n, capPerHost: 50_000_000n, remainingBudget: 100_000_000n };

  it("counts only verified, returning persons, once each", () => {
    const r = computeHostPayouts(
      [
        cand(1, host1),
        cand(1, host1), // second wallet of person 1
        cand(2, host1),
        cand(null, host1), // unverified
        cand(3, host1, { sealedEarlierMatchweek: false }), // first-timer
        cand(4, host1, { sealedThisMatchweek: false }), // did not play this week
        cand(5, host2),
      ],
      terms,
    );
    expect(r.payouts).toEqual([
      { host: "0x00000000000000000000000000000000000000A1", countablePlayers: 2, amount: 200_000n },
      { host: "0x00000000000000000000000000000000000000A2", countablePlayers: 1, amount: 100_000n },
    ]);
    expect(r.total).toBe(300_000n);
    expect(r.scaled).toBe(false);
  });

  it("caps each host", () => {
    const many = Array.from({ length: 600 }, (_, i) => cand(i + 1, host1));
    const r = computeHostPayouts(many, terms);
    expect(r.payouts[0]!.amount).toBe(50_000_000n);
    expect(r.payouts[0]!.countablePlayers).toBe(600);
  });

  it("scales down proportionally and never exceeds the budget", () => {
    const r = computeHostPayouts(
      [...Array.from({ length: 3 }, (_, i) => cand(i + 1, host1)), ...Array.from({ length: 1 }, (_, i) => cand(i + 100, host2))],
      { ...terms, remainingBudget: 200_001n },
    );
    expect(r.scaled).toBe(true);
    expect(r.total <= 200_001n).toBe(true);
    expect(r.payouts.map((x) => x.amount)).toEqual([150_000n, 50_000n]);
  });

  it("respects eligible leagues", () => {
    const r = computeHostPayouts([cand(1, host1), cand(2, host2)], { ...terms, eligibleLeagues: new Set(["ada"]) });
    expect(r.payouts.map((x) => x.countablePlayers)).toEqual([1]);
  });

  it("returns nothing when no one counts", () => {
    expect(computeHostPayouts([cand(null, host1)], terms)).toEqual({ payouts: [], total: 0n, scaled: false });
  });
});

describe("rules v2: beat the crowd and Banker", () => {
  it("has its own hash; matchweeks map to their rules", () => {
    expect(RULES_V2_HASH).not.toBe(RULES_V1_HASH);
    expect(rulesVersion(RULES_V1_HASH)).toBe(1);
    expect(rulesVersion(RULES_V2_HASH)).toBe(2);
    expect(CURRENT_RULES_HASH).toBe(RULES_V2_HASH);
    expect(() => rulesVersion(`0x${"ab".repeat(32)}`)).toThrow();
  });

  it("crowd bonus tiers use exact integer tests", () => {
    expect([crowdBonus(1, 10), crowdBonus(2, 10), crowdBonus(1, 4), crowdBonus(2, 8), crowdBonus(3, 8), crowdBonus(5, 10), crowdBonus(6, 10)]).toEqual([3, 2, 2, 2, 1, 1, 0]);
    expect(crowdBonus(0, 10)).toBe(0);
    expect(crowdBonus(1, 1)).toBe(0);
  });

  it("scores a worked example by hand", () => {
    // One fixture, a 2-1 home win. Ten players: 9 call a home win, 1 calls a draw.
    const results = [{ index: 0, homeGoals: 2, awayGoals: 1, status: "played" as const }];
    const homeFans = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, home: [1], away: [0] }));
    const exact = { id: "exact", home: [2], away: [1], banker: 0 }; // exact, Banker
    const draw = { id: "draw", home: [1], away: [1] };
    const scored = scoreEntries(2, [...homeFans, exact, draw], results);
    const by = Object.fromEntries(scored.map((s) => [s.id, s]));
    // 9 of 10 called the home win: no bonus. Right result 2; exact 5, doubled by the Banker = 10.
    expect(by.h0).toMatchObject({ points: 2, exactScores: 0 });
    expect(by.exact).toMatchObject({ points: 10, exactScores: 1 });
    expect(by.draw).toMatchObject({ points: 0 });
  });

  it("rewards the contrarian who was right, Banker included", () => {
    // A 0-0 draw that only 1 of 10 players called: +3 bonus.
    const results = [{ index: 0, homeGoals: 0, awayGoals: 0, status: "played" as const }];
    const others = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, home: [2], away: [0] }));
    const brave = { id: "brave", home: [0], away: [0], banker: 0 };
    const scored = scoreEntries(2, [...others, brave], results);
    expect(scored.find((s) => s.id === "brave")).toMatchObject({ points: (5 + 3) * 2, exactScores: 1 });
    expect(scored.find((s) => s.id === "o0")).toMatchObject({ points: 0 });
  });

  it("void fixtures score zero even on the Banker; no Banker (255) doubles nothing", () => {
    const results = [
      { index: 0, homeGoals: 0, awayGoals: 0, status: "void" as const },
      { index: 1, homeGoals: 1, awayGoals: 0, status: "played" as const },
    ];
    const a = { id: "a", home: [0, 1], away: [0, 0], banker: 0 };
    const b = { id: "b", home: [0, 1], away: [0, 0], banker: 255 };
    const scored = scoreEntries(2, [a, b], results);
    // Both called the 1-0 exactly; 2 of 2 called it: no bonus.
    expect(scored.map((s) => s.points)).toEqual([5, 5]);
  });

  it("v1 scoring is unchanged by the new code path", () => {
    const results = [{ index: 0, homeGoals: 2, awayGoals: 1, status: "played" as const }];
    const scored = scoreEntries(1, [{ id: "x", home: [2], away: [1], banker: 0 }], results);
    expect(scored[0]).toMatchObject({ points: 5, exactScores: 1 });
  });
});
